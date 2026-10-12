import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ORDER_SELL = "sell";
g.ORDER_BUY = "buy";

const { loop, bookTrades, heldGold, heldSellFloor, goldBuyCap, describeDesk } = await import(
  "../src/orchestrators/orchestrator.golddesk"
);

type FakeOrder = {
  id: string;
  type: string;
  resourceType: string;
  price: number;
  amount: number;
  remainingAmount: number;
  roomName: string;
};

// Gold's daily averages as shard1 stood on 2026-10-12: about 86 for two
// weeks, then 55.8 and 35 as it fell.
const SLUMP = [52.1, 53, 74.4, 93.4, 84.3, 78.2, 91.5, 86.4, 97.1, 101.1, 105.7, 103.3, 102.8, 55.8, 35];
// The same fortnight, had gold recovered to 80 on its last day.
const CALM = [...SLUMP.slice(0, -1), 80];

let clock = 1_000_000;
let calls: string[];
let mine: Record<string, FakeOrder>;

function terminal(energy: number) {
  return { my: true, store: { energy, getFreeCapacity: () => 200_000 } };
}

function realm(opts: {
  days?: number[];
  credits?: number;
  rivals?: FakeOrder[];
  incoming?: unknown[];
  outgoing?: unknown[];
  terminals?: Record<string, number>;
}) {
  calls = [];
  clock += 1000;
  const rooms: Record<string, unknown> = {};
  const stored: Record<string, number> = { W48S7: 27_000, W48S8: 8_000 };
  for (const [name, energy] of Object.entries(stored)) {
    rooms[name] = {
      name,
      controller: { my: true },
      storage: { store: { energy } },
      terminal: terminal(opts.terminals?.[name] ?? 10_000),
    };
  }
  g.Game = {
    time: clock,
    rooms,
    market: {
      credits: opts.credits ?? 5_944_916,
      orders: mine,
      incomingTransactions: opts.incoming ?? [],
      outgoingTransactions: opts.outgoing ?? [],
      getHistory: () => (opts.days ?? SLUMP).map((avgPrice) => ({ avgPrice })),
      getAllOrders: () => [...(opts.rivals ?? []), ...Object.values(mine)],
      createOrder: (o: { type: string; price: number; totalAmount: number; roomName: string }) => {
        calls.push(`create:${o.type}:${o.roomName}:${o.totalAmount}@${o.price}`);
        const id = `mine${Object.keys(mine).length}`;
        mine[id] = { id, resourceType: "energy", amount: o.totalAmount, remainingAmount: o.totalAmount, ...o };
        return 0;
      },
      cancelOrder: (id: string) => {
        calls.push(`cancel:${id}`);
        delete mine[id];
        return 0;
      },
      changeOrderPrice: (id: string, price: number) => {
        calls.push(`reprice:${id}@${price}`);
        mine[id].price = price;
        return 0;
      },
      extendOrder: (id: string, add: number) => {
        calls.push(`extend:${id}+${add}`);
        return 0;
      },
    },
  };
}

const rivalBid = (price: number): FakeOrder => ({
  id: `bid${price}`,
  type: "buy",
  resourceType: "energy",
  price,
  amount: 20_000,
  remainingAmount: 20_000,
  roomName: "W40S1",
});
const rivalAsk = (price: number): FakeOrder => ({ ...rivalBid(price), id: `ask${price}`, type: "sell" });

const fill = (amount: number, price: number, to: string, time: number) => ({
  time,
  sender: { username: "Seller" },
  recipient: { username: "Mcflubbin" },
  resourceType: "energy",
  amount,
  to,
  from: "W40S1",
  order: { id: "mine0", type: "buy", price },
});

const sale = (amount: number, price: number, from: string, time: number) => ({
  time,
  sender: { username: "Mcflubbin" },
  recipient: { username: "Buyer" },
  resourceType: "energy",
  amount,
  from,
  to: "W40S1",
  order: { id: "theirs", type: "buy", price },
});

// The desk's history and order book are cached on the heap for a while; each
// test starts on a tick far enough on to read them fresh, on the desk's beat.
function runDesk(): void {
  (g.Game as { time: number }).time = clock - (clock % 50);
  loop();
}

beforeEach(() => {
  mine = {};
  g.Memory = {};
});

describe("the gold desk's bid", () => {
  it("bids just over the best rival at the poorest castle while gold is cheap", () => {
    realm({ rivals: [rivalBid(36.5), rivalBid(35.4)] });
    runDesk();
    expect(calls).toEqual(["create:buy:W48S8:20000@36.51"]);
  });

  it("never bids over the share of the usual price it calls cheap", () => {
    realm({ rivals: [rivalBid(60)] });
    runDesk();
    // Usual is the median, 86.4; cheap is under 60% of it.
    expect(calls).toEqual(["create:buy:W48S8:20000@51.84"]);
  });

  it("does not bid while gold sells near its usual price", () => {
    realm({ days: CALM, rivals: [rivalBid(36.5)] });
    runDesk();
    expect(calls).toEqual([]);
    expect(goldBuyCap()).toBeUndefined();
  });

  it("withdraws the bid once gold climbs back", () => {
    realm({ rivals: [rivalBid(36.5)] });
    runDesk();
    realm({ days: [...SLUMP.slice(0, -1), 70], rivals: [rivalBid(36.5)] });
    runDesk();
    expect(calls).toEqual(["cancel:mine0"]);
  });

  it("keeps the credit reserve whatever the budget allows", () => {
    realm({ credits: 3_200_000, rivals: [rivalBid(36.5)] });
    runDesk();
    // 200k over the reserve buys 5217 at 36.51 with the 5% fee.
    expect(calls).toEqual(["create:buy:W48S8:5217@36.51"]);
  });

  it("follows a rival who outbids it", () => {
    realm({ rivals: [rivalBid(36.5)] });
    runDesk();
    realm({ rivals: [rivalBid(40)] });
    runDesk();
    expect(calls).toEqual(["reprice:mine0@40.01"]);
  });
});

describe("the gold desk's books", () => {
  it("holds half of what the bid buys and feeds the rest", () => {
    realm({ days: CALM });
    runDesk();
    const t = clock;
    realm({ incoming: [fill(20_000, 36.5, "W48S8", t + 10)], terminals: { W48S8: 30_000 } });
    bookTrades();
    expect(heldGold("W48S8")).toBe(10_000);
    expect(Memory.goldDesk!.invested).toBeCloseTo(730_000);
  });

  it("books a sale out of held gold and what it brought back", () => {
    realm({ days: CALM });
    runDesk();
    const t = clock;
    realm({ incoming: [fill(20_000, 36.5, "W48S8", t + 10)] });
    bookTrades();
    realm({ outgoing: [sale(4_000, 80, "W48S8", clock + 10)] });
    bookTrades();
    expect(heldGold("W48S8")).toBe(6_000);
    expect(Memory.goldDesk!.invested).toBeCloseTo(730_000 - 320_000);
  });

  it("books a send between our own castles as no trade", () => {
    realm({ days: CALM });
    runDesk();
    const send = { ...fill(20_000, 36.5, "W48S8", clock + 10), sender: { username: "Mcflubbin" } };
    realm({ incoming: [send] });
    bookTrades();
    expect(heldGold("W48S8")).toBe(0);
  });

  it("holds no more than the terminal has", () => {
    realm({ days: CALM });
    runDesk();
    realm({ incoming: [fill(20_000, 36.5, "W48S8", clock + 10)], terminals: { W48S8: 5_000 } });
    runDesk();
    expect(heldGold("W48S8")).toBe(4_000);
  });
});

describe("the gold desk's asks", () => {
  function holding() {
    realm({ days: CALM });
    runDesk();
    realm({ incoming: [fill(20_000, 36.5, "W48S8", clock + 10)], terminals: { W48S8: 30_000 } });
    bookTrades();
  }

  it("keeps held gold off the market while the price is low", () => {
    holding();
    realm({ rivals: [rivalAsk(81.4)], terminals: { W48S8: 30_000 } });
    runDesk();
    expect(calls.filter((c) => c.startsWith("create:sell"))).toEqual([]);
  });

  it("offers held gold under the best rival once the price climbs back", () => {
    holding();
    realm({ days: [...SLUMP.slice(0, -1), 75], rivals: [rivalAsk(81.4)], terminals: { W48S8: 30_000 } });
    runDesk();
    expect(calls).toEqual(["create:sell:W48S8:10000@81.39"]);
  });

  it("never offers it under the floor", () => {
    holding();
    realm({ days: [...SLUMP.slice(0, -1), 75], rivals: [rivalAsk(50)], terminals: { W48S8: 30_000 } });
    runDesk();
    // 80% of the usual 86.4.
    expect(heldSellFloor()).toBeCloseTo(69.12);
    expect(calls).toEqual(["create:sell:W48S8:10000@69.12"]);
  });

  it("reports what it holds and what it has out", () => {
    holding();
    expect(describeDesk().join("\n")).toContain("held at W48S8: 10000");
  });
});
