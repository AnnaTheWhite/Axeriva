import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";

dotenv.config();

async function main() {
  const email = process.argv[2] || process.env.DEVELOPER_EMAIL;
  const password = process.argv[3] || process.env.DEVELOPER_PASSWORD;

  if (!email || !password) {
    console.error(
      "Usage: npm run seed:developer -- <email> <password>\n" +
        "(or set DEVELOPER_EMAIL / DEVELOPER_PASSWORD env vars)"
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.error(`A user with email ${email} already exists.`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      role: ROLES.DEVELOPER,
      companyId: null,
      // Seeded directly by an operator, not via public registration — no
      // email loop to close.
      emailVerified: true,
    },
  });

  console.log(`Created DEVELOPER user #${user.id} (${user.email})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
