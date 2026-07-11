import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { config } from "../config";

async function main() {
  const email = process.argv[2] || config.developerEmail;
  const password = process.argv[3] || config.developerPassword;

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
