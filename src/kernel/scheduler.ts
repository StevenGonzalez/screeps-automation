// src/kernel/scheduler.ts
export type JobFn = () => void;

interface Job {
  id: string;
  fn: JobFn;
  interval: number;
  lastRun: number;
}

export class Scheduler {
  private jobs: Record<string, Job> = {};

  schedule(id: string, fn: JobFn, interval = 1) {
    this.jobs[id] = { id, fn, interval, lastRun: -Infinity };
  }

  unschedule(id: string) {
    delete this.jobs[id];
  }

  run() {
    const t = Game.time;
    for (const id in this.jobs) {
      const j = this.jobs[id];
      if (t - j.lastRun >= j.interval) {
        try { j.fn(); } catch (err) { console.log(`Scheduler job ${id} error: ${err}`); }
        j.lastRun = t;
      }
    }
  }
}
