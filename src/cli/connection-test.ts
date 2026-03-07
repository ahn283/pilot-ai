/**
 * Tests messenger connections during onboarding.
 * These are lightweight API calls to verify tokens are valid.
 */

export async function testSlackConnection(botToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
    });
    const data = (await res.json()) as { ok: boolean; error?: string; user?: string; team?: string };
    if (data.ok) {
      return { ok: true };
    }
    return { ok: false, error: data.error ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function testTelegramConnection(botToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await res.json()) as { ok: boolean; description?: string; result?: { username: string } };
    if (data.ok) {
      return { ok: true };
    }
    return { ok: false, error: data.description ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
