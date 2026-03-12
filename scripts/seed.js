import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const run = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const orgName = 'Quintal Gonza';
  const phone = '559999999999';

  const orgResult = await client.query(
    'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
    [orgName]
  );
  const orgId = orgResult.rows[0].id;

  const userResult = await client.query(
    'INSERT INTO users (organization_id, phone, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [orgId, phone, 'Cliente Demo', 'customer']
  );
  const userId = userResult.rows[0].id;

  await client.query(
    'INSERT INTO wallets (organization_id, user_id, balance) VALUES ($1, $2, $3)',
    [orgId, userId, 10]
  );

  const spaceResult = await client.query(
    'INSERT INTO spaces (organization_id, name, location, capacity, available_start, available_end) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [orgId, 'Sala Principal', 'Quintal Gonza', 20, '08:00', '22:00']
  );
  const spaceId = spaceResult.rows[0].id;

  await client.end();

  console.log('Seed complete');
  console.log(`ORG_ID=${orgId}`);
  console.log(`SPACE_ID=${spaceId}`);
  console.log(`USER_PHONE=${phone}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
