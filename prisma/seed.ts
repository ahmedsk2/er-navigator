/**
 * Seed: reference lists from Appendix A (verbatim) + the first ADMIN user from env.
 * Idempotent — every write is an upsert keyed on the natural key, so running it on every
 * deploy is safe and never duplicates. It never touches Case data.
 *
 * Runs as the OWNER role inside the `migrate` service (scripts/migrate-and-seed.sh).
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/db'
import { DEPARTMENTS, OTHER, STAGES, WARDS } from '../src/lib/domain/taxonomy'

async function seedTaxonomy() {
  let stageOrder = 0
  for (const s of STAGES) {
    stageOrder += 1
    const stage = await prisma.stage.upsert({
      where: { code: s.code },
      create: { code: s.code, name: s.name, sortOrder: stageOrder },
      update: { name: s.name, sortOrder: stageOrder },
    })
    let reasonOrder = 0
    for (const r of s.reasons) {
      reasonOrder += 1
      await prisma.reason.upsert({
        where: { stageId_name: { stageId: stage.id, name: r.name } },
        create: {
          stageId: stage.id,
          name: r.name,
          sortOrder: reasonOrder,
          requiresDepartment: r.requiresDepartment ?? false,
          requiresReferralNo: r.requiresReferralNo ?? false,
        },
        update: {
          sortOrder: reasonOrder,
          requiresDepartment: r.requiresDepartment ?? false,
          requiresReferralNo: r.requiresReferralNo ?? false,
        },
      })
    }
    // Every stage gets exactly one "Other" reason, last in order.
    await prisma.reason.upsert({
      where: { stageId_name: { stageId: stage.id, name: OTHER } },
      create: { stageId: stage.id, name: OTHER, sortOrder: 999, isOther: true },
      update: { sortOrder: 999, isOther: true },
    })
  }
  let i = 0
  for (const name of DEPARTMENTS) {
    i += 1
    await prisma.department.upsert({ where: { name }, create: { name, sortOrder: i }, update: { sortOrder: i } })
  }
  i = 0
  for (const w of WARDS) {
    i += 1
    await prisma.ward.upsert({
      where: { code: w.code },
      create: { code: w.code, name: w.name, sortOrder: i },
      update: { name: w.name, sortOrder: i },
    })
  }
}

async function seedFirstAdmin() {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || 'Administrator'
  if (!username || !password) {
    console.log('[seed] ADMIN_USERNAME/ADMIN_PASSWORD not set — skipping first admin')
    return
  }
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    console.log(`[seed] admin "${username}" already exists — leaving it untouched`)
    return
  }
  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.create({ data: { username, passwordHash, displayName, role: 'ADMIN' } })
  console.log(`[seed] created first ADMIN "${username}"`)
}

async function main() {
  await seedTaxonomy()
  await seedFirstAdmin()
  const counts = await Promise.all([
    prisma.stage.count(),
    prisma.reason.count(),
    prisma.department.count(),
    prisma.ward.count(),
    prisma.user.count(),
  ])
  console.log(`[seed] stages=${counts[0]} reasons=${counts[1]} departments=${counts[2]} wards=${counts[3]} users=${counts[4]}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
