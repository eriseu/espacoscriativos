import express from 'express';
import dotenv from 'dotenv';
import { query, withTransaction } from './db.js';

dotenv.config();

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

const normalizeText = (text) => (text || '').trim().toLowerCase();

const getOrgId = (body) => body.organization_id || process.env.ORG_DEFAULT_ID;
const adminPhone = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');

const ensureOrgId = (orgId) => {
  if (!orgId) {
    const err = new Error('organization_id is required');
    err.status = 400;
    throw err;
  }
  return orgId;
};

const findOrCreateUser = async (client, orgId, phone) => {
  const existing = await client.query(
    'SELECT id FROM users WHERE organization_id = $1 AND phone = $2',
    [orgId, phone]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const created = await client.query(
    'INSERT INTO users (organization_id, phone, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [orgId, phone, null, 'customer']
  );
  const userId = created.rows[0].id;

  await client.query(
    'INSERT INTO wallets (organization_id, user_id, balance) VALUES ($1, $2, $3)',
    [orgId, userId, 0]
  );

  return userId;
};

const getWalletBalance = async (orgId, userId) => {
  const result = await query(
    'SELECT balance FROM wallets WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return result.rows[0]?.balance ?? 0;
};

const createReservation = async ({ orgId, phone, spaceId, startTime, endTime }) => {
  if (!spaceId) {
    const err = new Error('space_id is required');
    err.status = 400;
    throw err;
  }

  if (!startTime || !endTime) {
    const err = new Error('start_time and end_time are required');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const userId = await findOrCreateUser(client, orgId, phone);

    const overlap = await client.query(
      `SELECT id FROM reservations
       WHERE organization_id = $1
         AND space_id = $2
         AND status = 'confirmed'
         AND tstzrange(start_time, end_time, '[)') && tstzrange($3, $4, '[)')`,
      [orgId, spaceId, startTime, endTime]
    );
    if (overlap.rows.length > 0) {
      const err = new Error('space not available for this time slot');
      err.status = 409;
      throw err;
    }

    const durationMs = new Date(endTime) - new Date(startTime);
    if (Number.isNaN(durationMs) || durationMs <= 0) {
      const err = new Error('invalid time range');
      err.status = 400;
      throw err;
    }

    const hours = Math.ceil(durationMs / (1000 * 60 * 60));
    const wallet = await client.query(
      'SELECT id, balance FROM wallets WHERE organization_id = $1 AND user_id = $2',
      [orgId, userId]
    );
    const walletRow = wallet.rows[0];
    if (!walletRow || walletRow.balance < hours) {
      const err = new Error('insufficient credits');
      err.status = 402;
      throw err;
    }

    await client.query(
      'UPDATE wallets SET balance = balance - $1 WHERE id = $2',
      [hours, walletRow.id]
    );

    await client.query(
      'INSERT INTO credit_transactions (organization_id, user_id, amount, type, reason) VALUES ($1, $2, $3, $4, $5)',
      [orgId, userId, -hours, 'reservation_usage', 'Reserva via WhatsApp']
    );

    const reservation = await client.query(
      `INSERT INTO reservations
        (organization_id, space_id, user_id, start_time, end_time, credits_consumed, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
       RETURNING id`,
      [orgId, spaceId, userId, startTime, endTime, hours]
    );

    return { id: reservation.rows[0].id, credits: hours };
  });
};

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/admin/spaces', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(getOrgId(req.body));
    const { name, location, capacity, available_start, available_end } = req.body;

    if (!name) {
      const err = new Error('name is required');
      err.status = 400;
      throw err;
    }

    const created = await query(
      `INSERT INTO spaces
        (organization_id, name, location, capacity, available_start, available_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [orgId, name, location || null, capacity || null, available_start || null, available_end || null]
    );

    res.status(201).json({ id: created.rows[0].id });
  } catch (err) {
    next(err);
  }
});

app.get('/admin/spaces', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(req.query.organization_id || process.env.ORG_DEFAULT_ID);
    const result = await query(
      `SELECT id, name, location, capacity, available_start, available_end
       FROM spaces
       WHERE organization_id = $1
       ORDER BY created_at ASC`,
      [orgId]
    );
    res.json({ spaces: result.rows });
  } catch (err) {
    next(err);
  }
});

app.get('/users/:phone/balance', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(req.query.organization_id || process.env.ORG_DEFAULT_ID);
    const { phone } = req.params;

    const user = await query(
      'SELECT id FROM users WHERE organization_id = $1 AND phone = $2',
      [orgId, phone]
    );
    if (user.rows.length === 0) {
      return res.json({ balance: 0 });
    }

    const balance = await getWalletBalance(orgId, user.rows[0].id);
    res.json({ balance });
  } catch (err) {
    next(err);
  }
});

app.get('/users/:phone/agenda', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(req.query.organization_id || process.env.ORG_DEFAULT_ID);
    const { phone } = req.params;
    const date = req.query.date;
    if (!date) {
      const err = new Error('date is required (YYYY-MM-DD)');
      err.status = 400;
      throw err;
    }

    const user = await query(
      'SELECT id FROM users WHERE organization_id = $1 AND phone = $2',
      [orgId, phone]
    );
    if (user.rows.length === 0) {
      return res.json({ reservations: [] });
    }

    const reservations = await query(
      `SELECT r.id, r.start_time, r.end_time, s.name AS space_name
       FROM reservations r
       JOIN spaces s ON s.id = r.space_id
       WHERE r.organization_id = $1
         AND r.user_id = $2
         AND r.status = 'confirmed'
         AND r.start_time::date = $3::date
       ORDER BY r.start_time`,
      [orgId, user.rows[0].id, date]
    );

    res.json({ reservations: reservations.rows });
  } catch (err) {
    next(err);
  }
});

app.post('/reservations', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(getOrgId(req.body));
    const { phone, space_id: spaceId, start_time: startTime, end_time: endTime } = req.body;

    if (!phone) {
      const err = new Error('phone is required');
      err.status = 400;
      throw err;
    }

    const reservation = await createReservation({
      orgId,
      phone,
      spaceId,
      startTime,
      endTime
    });

    res.status(201).json(reservation);
  } catch (err) {
    next(err);
  }
});

app.post('/admin/credits/adjust', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(getOrgId(req.body));
    const { phone, amount, reason } = req.body;

    if (!phone || typeof amount !== 'number') {
      const err = new Error('phone and amount are required');
      err.status = 400;
      throw err;
    }

    await withTransaction(async (client) => {
      const userId = await findOrCreateUser(client, orgId, phone);
      await client.query(
        'UPDATE wallets SET balance = balance + $1 WHERE organization_id = $2 AND user_id = $3',
        [amount, orgId, userId]
      );
      await client.query(
        'INSERT INTO credit_transactions (organization_id, user_id, amount, type, reason) VALUES ($1, $2, $3, $4, $5)',
        [orgId, userId, amount, 'manual_adjustment', reason || 'Ajuste manual']
      );
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/whatsapp/handle', async (req, res, next) => {
  try {
    const orgId = ensureOrgId(getOrgId(req.body));
    const { phone, text, space_id: spaceId, today } = req.body;

    if (!phone || !text) {
      const err = new Error('phone and text are required');
      err.status = 400;
      throw err;
    }

    const normalized = normalizeText(text);
    const normalizedPhone = phone.replace(/\D/g, '');

    if (normalized.startsWith('credito ')) {
      if (!adminPhone || normalizedPhone !== adminPhone) {
        return res.json({ reply: 'Comando restrito ao administrador.' });
      }

      const parts = normalized.split(' ');
      if (parts.length < 3) {
        return res.json({ reply: 'Use: credito <telefone> <quantidade>' });
      }

      const targetPhone = parts[1].replace(/\D/g, '');
      const amount = Number(parts[2]);
      if (!targetPhone || !Number.isFinite(amount)) {
        return res.json({ reply: 'Use: credito <telefone> <quantidade>' });
      }

      await withTransaction(async (client) => {
        const userId = await findOrCreateUser(client, orgId, targetPhone);
        await client.query(
          'UPDATE wallets SET balance = balance + $1 WHERE organization_id = $2 AND user_id = $3',
          [amount, orgId, userId]
        );
        await client.query(
          'INSERT INTO credit_transactions (organization_id, user_id, amount, type, reason) VALUES ($1, $2, $3, $4, $5)',
          [orgId, userId, amount, 'manual_adjustment', 'Carga via WhatsApp']
        );
      });

      return res.json({ reply: `Crédito aplicado para ${targetPhone}.` });
    }

    if (normalized.startsWith('saldo ')) {
      if (!adminPhone || normalizedPhone !== adminPhone) {
        return res.json({ reply: 'Comando restrito ao administrador.' });
      }

      const parts = normalized.split(' ');
      if (parts.length < 2) {
        return res.json({ reply: 'Use: saldo <telefone>' });
      }

      const targetPhone = parts[1].replace(/\D/g, '');
      if (!targetPhone) {
        return res.json({ reply: 'Use: saldo <telefone>' });
      }

      const user = await query(
        'SELECT id FROM users WHERE organization_id = $1 AND phone = $2',
        [orgId, targetPhone]
      );
      if (user.rows.length === 0) {
        return res.json({ reply: `Saldo de ${targetPhone}: 0 créditos.` });
      }

      const balance = await getWalletBalance(orgId, user.rows[0].id);
      return res.json({ reply: `Saldo de ${targetPhone}: ${balance} crédito(s).` });
    }

    if (normalized === 'saldo') {
      const user = await query(
        'SELECT id FROM users WHERE organization_id = $1 AND phone = $2',
        [orgId, normalizedPhone]
      );
      if (user.rows.length === 0) {
        return res.json({ reply: 'Seu saldo é 0 créditos.' });
      }
      const balance = await getWalletBalance(orgId, user.rows[0].id);
      return res.json({ reply: `Seu saldo é ${balance} crédito(s).` });
    }

    if (normalized === 'comandos' || normalized === 'ajuda' || normalized === 'help') {
      return res.json({
        reply: [
          'Comandos disponíveis:',
          'saldo',
          'agenda hoje',
          'reservar HH:MM',
          'credito <telefone> <quantidade> (admin)',
          'saldo <telefone> (admin)'
        ].join('\n')
      });
    }

    if (normalized === 'agenda hoje') {
      const date = today || new Date().toISOString().slice(0, 10);
      const response = await query(
        `SELECT r.start_time, r.end_time, s.name AS space_name
         FROM reservations r
         JOIN spaces s ON s.id = r.space_id
         JOIN users u ON u.id = r.user_id
         WHERE r.organization_id = $1
           AND u.phone = $2
           AND r.status = 'confirmed'
           AND r.start_time::date = $3::date
         ORDER BY r.start_time`,
        [orgId, normalizedPhone, date]
      );

      if (response.rows.length === 0) {
        return res.json({ reply: 'Nenhuma reserva para hoje.' });
      }

      const lines = response.rows.map((r) => {
        const start = new Date(r.start_time).toISOString().slice(11, 16);
        const end = new Date(r.end_time).toISOString().slice(11, 16);
        return `${start}-${end} ${r.space_name}`;
      });

      return res.json({ reply: `Agenda de hoje:\n${lines.join('\n')}` });
    }

    if (normalized.startsWith('reservar ')) {
      const time = normalized.replace('reservar ', '').trim();
      const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
      if (!match) {
        return res.json({ reply: 'Formato inválido. Use: reservar HH:MM' });
      }

      const date = today || new Date().toISOString().slice(0, 10);
      const startTime = `${date}T${time}:00.000Z`;
      const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();

      let selectedSpaceId = spaceId;
      if (!selectedSpaceId) {
        const space = await query(
          'SELECT id FROM spaces WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1',
          [orgId]
        );
        if (space.rows.length === 0) {
          return res.json({ reply: 'Nenhum espaço cadastrado.' });
        }
        selectedSpaceId = space.rows[0].id;
      }

      const reservation = await createReservation({
        orgId,
        phone: normalizedPhone,
        spaceId: selectedSpaceId,
        startTime,
        endTime
      });

      return res.json({ reply: `Reserva confirmada. Créditos usados: ${reservation.credits}.` });
    }

    return res.json({ reply: null });
  } catch (err) {
    const status = err.status || 500;
    if (status === 402) {
      return res.json({ reply: 'Saldo insuficiente para esta reserva.' });
    }
    if (status === 409) {
      return res.json({ reply: 'Horário indisponível para este espaço.' });
    }
    if (status === 400) {
      return res.json({ reply: 'Dados inválidos. Use: saldo, agenda hoje, reservar HH:MM' });
    }
    return res.json({ reply: 'Ocorreu um erro. Tente novamente em instantes.' });
  }
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal error' });
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
