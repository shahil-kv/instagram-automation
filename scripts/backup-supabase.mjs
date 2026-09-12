/**
 * Read-only export of every public table to backups/<timestamp>/.
 *
 * Run before applying any SQL migration:
 *   node scripts/backup-supabase.mjs
 *
 * Output contains access tokens, so backups/ is gitignored. Nothing is
 * written to the database — this only issues GETs.
 */
import fs from "node:fs"
import path from "node:path"

const TABLES = [
    "users",
    "automations",
    "webhook_events",
    "media_cache",
    "ice_breakers",
    "content_pool",
    "scheduler_config",
    "reels_posts",
    "dm_queue",
    "social_accounts",
    "post_jobs",
    "post_targets",
]

const PAGE = 1000

function loadEnv() {
    const file = fs.existsSync(".env.local") ? ".env.local" : ".env"
    return Object.fromEntries(
        fs
            .readFileSync(file, "utf8")
            .split("\n")
            .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
            .map((line) => [
                line.slice(0, line.indexOf("=")).trim(),
                line.slice(line.indexOf("=") + 1).trim(),
            ]),
    )
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = path.join("backups", stamp)
fs.mkdirSync(outDir, { recursive: true })

const summary = []

/**
 * Column names differ per table (created_at / processed_at / cached_at, and
 * scheduler_config has no `id` at all), so order by `id` when the table has
 * one and fall back to unordered paging when it does not.
 */
async function fetchPage(table, offset, ordered) {
    const order = ordered ? "&order=id.asc" : ""
    return fetch(`${url}/rest/v1/${table}?select=*${order}&limit=${PAGE}&offset=${offset}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
}

for (const table of TABLES) {
    const rows = []
    let from = 0
    let ordered = true

    while (true) {
        let res = await fetchPage(table, from, ordered)

        // 400 here means the order column does not exist — retry unordered.
        if (res.status === 400 && ordered) {
            ordered = false
            res = await fetchPage(table, from, ordered)
        }

        if (!res.ok) {
            // 404 = table absent in this install, which is fine.
            const detail = res.status === 404 ? "not present" : `HTTP ${res.status}`
            summary.push({ table, rows: null, note: detail })
            break
        }

        const page = await res.json()
        rows.push(...page)
        if (page.length < PAGE) {
            fs.writeFileSync(
                path.join(outDir, `${table}.json`),
                JSON.stringify(rows, null, 2),
            )
            summary.push({ table, rows: rows.length, note: ordered ? "saved" : "saved (unordered)" })
            break
        }
        from += PAGE
    }
}

fs.writeFileSync(
    path.join(outDir, "_manifest.json"),
    JSON.stringify({ takenAt: new Date().toISOString(), project: url, summary }, null, 2),
)

console.log(`\nBackup written to ${outDir}\n`)
for (const entry of summary) {
    const count = entry.rows === null ? "—" : String(entry.rows)
    console.log(`  ${entry.table.padEnd(18)} ${count.padStart(6)}  ${entry.note}`)
}
console.log("")
