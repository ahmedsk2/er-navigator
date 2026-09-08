/**
 * Seed: reference lists from Appendix A (verbatim) + the first ADMIN user from env.
 *
 * Contract: INSERT-IF-MISSING ONLY. The seed runs on every deploy (scripts/migrate-and-seed.sh),
 * and from Phase 6 Admin renames, reorders and deactivates these rows in the database. So the
 * seed never updates an existing row: a stage, reason, department or ward that already exists
 * (by natural key) is left exactly as Admin left it. The database is the source of truth; this
 * file only fills an empty one. Renames done by Admin are not re-created under the old name
 * either, because the seed only ever adds rows whose natural key is absent — a renamed reason
 * keeps its row and id, and the old name is simply gone.
 *
 * Idempotent, never touches Case data. Runs as the OWNER role inside the `migrate` service.
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/db'
import { DEPARTMENTS, OTHER, STAGES, WARDS } from '../src/lib/domain/taxonomy'

async function seedTaxonomy() {
  // Only an EMPTY reference table is filled. Once anything exists, Admin owns the list.
  const [stageCount, deptCount, wardCount] = await Promise.all([
    prisma.stage.count(),
    prisma.department.count(),
    prisma.ward.count(),
  ])

  if (stageCount === 0) {
    let stageOrder = 0
    for (const s of STAGES) {
      stageOrder += 1
      const stage = await prisma.stage.create({ data: { code: s.code, name: s.name, sortOrder: stageOrder } })
      let reasonOrder = 0
      for (const r of s.reasons) {
        reasonOrder += 1
        await prisma.reason.create({
          data: {
            stageId: stage.id,
            name: r.name,
            sortOrder: reasonOrder,
            requiresDepartment: r.requiresDepartment ?? false,
            requiresReferralNo: r.requiresReferralNo ?? false,
          },
        })
      }
      // Every stage gets exactly one "Other" reason, last in order.
      await prisma.reason.create({ data: { stageId: stage.id, name: OTHER, sortOrder: 999, isOther: true } })
    }
    console.log('[seed] stages and reasons created')
  } else {
    console.log(`[seed] stages already present (${stageCount}) — left untouched`)
  }

  if (deptCount === 0) {
    await prisma.department.createMany({ data: DEPARTMENTS.map((name, i) => ({ name, sortOrder: i + 1 })) })
    console.log('[seed] departments created')
  } else {
    console.log(`[seed] departments already present (${deptCount}) — left untouched`)
  }

  if (wardCount === 0) {
    await prisma.ward.createMany({ data: WARDS.map((w, i) => ({ code: w.code, name: w.name, sortOrder: i + 1 })) })
    console.log('[seed] wards created')
  } else {
    console.log(`[seed] wards already present (${wardCount}) — left untouched`)
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
