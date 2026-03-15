import dotenv from 'dotenv';

dotenv.config();

const apiBase = process.env.API_BASE_URL || 'http://localhost:3000';
const organizationId = process.env.ORG_DEFAULT_ID;

const [,, name, location, capacity, availableStart, availableEnd] = process.argv;

if (!organizationId) {
  console.error('ORG_DEFAULT_ID not set in .env');
  process.exit(1);
}

if (!name) {
  console.error('Usage: node scripts/create_space_via_api.js "Nome" "Local" 20 08:00 22:00');
  process.exit(1);
}

const payload = {
  organization_id: organizationId,
  name,
  location: location || null,
  capacity: capacity ? Number(capacity) : null,
  available_start: availableStart || null,
  available_end: availableEnd || null
};

const run = async () => {
  const response = await fetch(`${apiBase}/admin/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();
  console.log('Space created:', data);
};

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
