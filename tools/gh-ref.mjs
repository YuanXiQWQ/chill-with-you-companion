/**
 * 推送引用怎么定。gh-bootstrap 与它的测试共用这一份，避免两边各猜一套。
 *
 * PR 构建（pull_request）是 detached HEAD，`git branch --show-current` 返回空；
 * 这时必须推 HEAD 到 main。以前直接落到「分支名 = main」，于是
 * `git push <remote> main:refs/heads/main` 报 `src refspec main does not match any`，
 * 任何 PR 的 CI 都会挂在这一步。
 */
export function pickBranch(showCurrent) {
  const cur = String(showCurrent || '').trim()
  return cur ? { branch: cur, src: cur } : { branch: 'main', src: 'HEAD' }
}
