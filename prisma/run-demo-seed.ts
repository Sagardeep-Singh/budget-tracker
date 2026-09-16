import { prisma } from '../lib/db/prisma';
import { seedDemoData, DEMO_EMAIL } from './demo-seed';

seedDemoData()
  .then((result) => {
    console.log(`Seeded demo user ${DEMO_EMAIL}:`, result);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
