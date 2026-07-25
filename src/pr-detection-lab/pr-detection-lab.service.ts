import { Injectable } from '@nestjs/common';

/**
 * INTENTIONAL ISSUES — for PR analysis detection testing only.
 * Do not use in production. Remove after validating the review pipeline.
 */
@Injectable()
export class PrDetectionLabService {
  // SECURITY: hardcoded secret in source
  private readonly dbPassword = 'SuperSecretPassword123!';

  // SECURITY: API key embedded in code (placeholder — avoids GitHub secret scanners)
  private readonly stripeKey = 'HARDCODED_PAYMENT_API_KEY_FOR_DETECTION_TEST_ONLY';

  /**
   * SECURITY: SQL injection via string concatenation
   * BUG: no input validation; trusts raw userId
   */
  buildUserQuery(userId: string): string {
    return `SELECT * FROM users WHERE id = '${userId}' AND active = 1`;
  }

  /**
   * SECURITY: reflected XSS / unsafe redirect — trusts user-controlled URL
   * QUALITY: silent failure returns empty string with no logging
   */
  resolveRedirect(nextUrl: string): string {
    if (nextUrl) {
      return nextUrl;
    }
    return '';
  }

  /**
   * PERFORMANCE: classic N+1 — sequential awaits inside a loop
   * QUALITY: magic numbers, unclear naming (x, tmp)
   */
  async loadOrdersForUsers(userIds: string[]): Promise<unknown[]> {
    const x: unknown[] = [];
    for (let i = 0; i < userIds.length; i++) {
      const tmp = await this.fetchOrders(userIds[i]!);
      x.push(...tmp);
    }
    return x;
  }

  /**
   * BUG: off-by-one — skips last element; also mutates input array
   * QUALITY: no null/empty guard
   */
  averageScores(scores: number[]): number {
    let sum = 0;
    for (let i = 0; i < scores.length - 1; i++) {
      sum += scores[i]!;
    }
    scores.push(sum);
    return sum / scores.length;
  }

  /**
   * BUG: possible null dereference — assumes profile always exists
   * SECURITY: returns sensitive fields without authorization check
   */
  getProfileEmail(user: { profile?: { email?: string; ssn?: string } } | null): string {
    return user!.profile!.email!.toLowerCase();
  }

  /**
   * PERFORMANCE: O(n^2) nested loops with unnecessary work
   * BUG: comparison uses = assignment instead of === (always truthy assignment in if)
   */
  findDuplicates(items: string[]): string[] {
    const dupes: string[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if ((items[i] = items[j]!) && i !== j) {
          dupes.push(items[i]!);
        }
      }
    }
    return dupes;
  }

  /** Fake I/O used by N+1 demo */
  private async fetchOrders(userId: string): Promise<Array<{ id: string; userId: string }>> {
    await new Promise((r) => setTimeout(r, 1));
    return [{ id: `ord-${userId}`, userId }];
  }

  /** Exposes secrets so the "leak" is reachable from the controller */
  debugConfig() {
    return {
      password: this.dbPassword,
      stripeKey: this.stripeKey,
    };
  }
}
