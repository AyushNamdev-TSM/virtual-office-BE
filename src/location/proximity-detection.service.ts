import { Injectable, Logger } from '@nestjs/common';

type Loc = { userId: string; username: string; x: number; y: number };

// Assuming ProximityEvent is defined elsewhere, e.g.:
export type ProximityEvent = {
  user1: Loc;
  user2: Loc;
  distance: number;
};

@Injectable()
export class ProximityDetectionService {
  private readonly logger = new Logger(ProximityDetectionService.name);
  private readonly DEFAULT_RADIUS = Number(process.env.PROXIMITY_RADIUS || 30);
  private readonly ALERT_COOLDOWN = Number(
    process.env.ALERT_COOLDOWN_MS || 10000,
  ); // 10 seconds

  // Cache to avoid repeated alerts: key "u1:u2" -> timestamp
  private activeAlerts = new Map<string, number>();

  private distance(a: Loc, b: Loc): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  detectProximities(
    current: Loc,
    others: Loc[],
    radius = this.DEFAULT_RADIUS,
  ): ProximityEvent[] {
    const results: ProximityEvent[] = [];
    const now = Date.now();

    for (const o of others) {
      if (!o || o.userId === current.userId) continue;

      const d = this.distance(current, o);
      if (d > radius) continue;

      // Check cooldown
      const k1 = `${current.userId}:${o.userId}`;
      const k2 = `${o.userId}:${current.userId}`;
      const last1 = this.activeAlerts.get(k1) || 0;
      const last2 = this.activeAlerts.get(k2) || 0;

      if (
        now - last1 >= this.ALERT_COOLDOWN &&
        now - last2 >= this.ALERT_COOLDOWN
      ) {
        this.activeAlerts.set(k1, now);
        this.activeAlerts.set(k2, now);
        results.push({ user1: current, user2: o, distance: d });
      }
    }
    return results;
  }

  clearProximityAlert(u1: string, u2: string) {
    this.activeAlerts.delete(`${u1}:${u2}`);
    this.activeAlerts.delete(`${u2}:${u1}`);
    this.logger.debug(`Cleared proximity alert between ${u1} and ${u2}`);
  }
}
