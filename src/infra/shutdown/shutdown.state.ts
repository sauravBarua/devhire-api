import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private shuttingDown = false;

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  begin(): void {
    this.shuttingDown = true;
  }
}
