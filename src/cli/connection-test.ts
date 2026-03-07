/**
 * Tests messenger connections during onboarding.
 * Step 1: Verify token validity (auth.test / getMe)
 * Step 2: Send a test message to the user
 */

export async function testSlackConnection(
  botToken: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1. Verify token
    const authRes = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
    });
    const authData = (await authRes.json()) as { ok: boolean; error?: string };
    if (!authData.ok) {
      return { ok: false, error: `Token invalid: ${authData.error}` };
    }

    // 2. Open DM channel with user
    const convRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ users: userId }),
    });
    const convData = (await convRes.json()) as {
      ok: boolean;
      error?: string;
      channel?: { id: string };
    };
    if (!convData.ok) {
      return { ok: false, error: `Cannot open DM: ${convData.error}` };
    }

    // 3. Send test message
    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: convData.channel!.id,
        text: 'Pilot AI connected successfully! Ready to receive commands.',
      }),
    });
    const msgData = (await msgRes.json()) as { ok: boolean; error?: string };
    if (!msgData.ok) {
      return { ok: false, error: `Cannot send message: ${msgData.error}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function testTelegramConnection(
  botToken: string,
  chatId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1. Verify token
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = (await meRes.json()) as { ok: boolean; description?: string };
    if (!meData.ok) {
      return { ok: false, error: `Token invalid: ${meData.description}` };
    }

    // 2. Send test message
    const msgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'Pilot AI connected successfully! Ready to receive commands.',
      }),
    });
    const msgData = (await msgRes.json()) as { ok: boolean; description?: string };
    if (!msgData.ok) {
      return { ok: false, error: `Cannot send message: ${msgData.description}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
