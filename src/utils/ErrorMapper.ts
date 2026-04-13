/**
 * The Royal Scribe
 * Records and reports issues to the Crown
 */

export class ErrorMapper {
  /**
   * Wraps a loop function to catch and properly report errors
   */
  public static wrapLoop(loop: () => void): () => void {
    return () => {
      try {
        loop();
      } catch (error: any) {
        if (error instanceof Error) {
          if ('sim' in Game.rooms) {
            const message = `Kingdom Error: ${error.message}<br>${error.stack}`;
            console.log(`<span style='color:red'>${message}</span>`);
          } else {
            console.log(`⚠️ Kingdom Error: ${error.message}\n${error.stack}`);
          }
        } else {
          console.log(`⚠️ Unknown error: ${error}`);
        }
      }
    };
  }
}
