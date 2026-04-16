import { NextRequest, NextResponse } from "next/server";
import { withCronGuard } from "@/lib/cron-helper";
import { getNotionClient, recordChangelog } from "@/lib/notion";

const GITHUB_REPO = "takeshiizawa123/next-procurement-poc";

interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; date: string };
    message: string;
  };
  files?: Array<{ filename: string }>;
}

/**
 * GitHubコミット履歴をNotion変更履歴DBへ同期
 * GET /api/cron/changelog-sync
 *
 * Vercel Cron: "0 10 * * *" (UTC 10:00 = JST 19:00, 毎日)
 *
 * 処理:
 * - GitHub APIから過去25時間のコミットを取得（cronの遅延を許容して25h）
 * - 各コミットをNotion ChangelogDBへ記録（重複hashはスキップ）
 *
 * 認証: GitHub APIはpublicリポジトリのため無認証(60 req/h)で十分
 */
export const GET = withCronGuard("changelog-sync", async (_request: NextRequest) => {
  const notion = getNotionClient();
  if (!notion) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "NOTION_API_KEY未設定",
    });
  }

  // 過去25時間のコミットを取得（cron遅延許容）
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?since=${since}&per_page=50`;

  const ghRes = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!ghRes.ok) {
    throw new Error(`GitHub API failed: ${ghRes.status} ${ghRes.statusText}`);
  }

  const commits: GitHubCommit[] = await ghRes.json();

  let recorded = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of commits) {
    // 各コミットの詳細（ファイル変更数）を取得
    let filesChanged = 0;
    try {
      const detailRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${c.sha}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        filesChanged = Array.isArray(detail.files) ? detail.files.length : 0;
      }
    } catch { /* ファイル数取得失敗は無視 */ }

    const ok = await recordChangelog({
      commitHash: c.sha,
      message: c.commit.message.split("\n")[0], // 1行目のみ
      author: c.commit.author.name,
      date: c.commit.author.date.split("T")[0],
      filesChanged,
    });
    if (ok) recorded++;
    else failed++;
  }

  console.log(`[changelog-sync] commits fetched=${commits.length}, recorded=${recorded}, skipped=${skipped}, failed=${failed}`);

  return NextResponse.json({
    ok: true,
    since,
    commitsFetched: commits.length,
    recorded,
    failed,
  });
});
