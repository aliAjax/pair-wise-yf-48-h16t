import esbuildPkg from "esbuild";
const { build: esbuildBuild } = esbuildPkg;
import { createRequire } from "module";
import vm from "node:vm";
import path from "node:path";

// ---- 极简 DOM：所有 tab 共享一个 localStorage（真实浏览器语义），storage 事件不发给写入者 ----
const sharedStore = new Map();
function makeTab(name, _backends, listeners) {
  const backend = {
    getItem: (k) => (sharedStore.has(k) ? sharedStore.get(k) : null),
    setItem: (k, v) => {
      const old = sharedStore.has(k) ? sharedStore.get(k) : null;
      sharedStore.set(k, String(v));
      if (old !== String(v)) {
        for (const [other, lns] of listeners) {
          if (other === name) continue;
          lns.slice().forEach((fn) => fn({ key: k, oldValue: old, newValue: String(v) }));
        }
      }
    },
    removeItem: (k) => sharedStore.delete(k),
    clear: () => sharedStore.clear()
  };
  listeners.set(name, []);
  return {
    localStorage: backend,
    window: {
      addEventListener: (_t, fn) => listeners.get(name).push(fn),
      removeEventListener() {}
    },
    crypto: { randomUUID: () => `uuid-${name}-${Math.random().toString(36).slice(2, 10)}` }
  };
}

async function makeStoreContext(name, backends, listeners) {
  const result = await esbuildBuild({
    entryPoints: [path.resolve("src/stores/review.ts")],
    bundle: true,
    format: "iife",
    globalName: "__review_mod__",
    platform: "browser",
    write: false,
    logLevel: "silent"
  });
  const code = result.outputFiles[0].text;
  const sandbox = { console, ...makeTab(name, backends, listeners) };
  vm.createContext(sandbox);
  vm.runInContext(`${code}; this.__mod__ = __review_mod__;`, sandbox);
  return sandbox.__mod__.useReviewStore;
}

function assert(cond, msg) {
  if (!cond) { console.error(`❌ ${msg}`); process.exitCode = 1; }
  else console.log(`✅ ${msg}`);
}

const backends = new Map();
const listeners = new Map();
const useA = await makeStoreContext("tabA", backends, listeners);
const useB = await makeStoreContext("tabB", backends, listeners);
const useC = await makeStoreContext("tabOrganizer", backends, listeners);

const { createPinia, setActivePinia } = await import("pinia");

function fresh(use) {
  const pinia = createPinia();
  setActivePinia(pinia);
  return use(pinia);
}

// 两个评委标签页（林策在 tabA、周筑在 tabB），主办方在 tabC
const piniaA = createPinia();
const piniaB = createPinia();
const piniaC = createPinia();
const A = useA(piniaA);
const B = useB(piniaB);
const C = useC(piniaC);
A.setViewer("评委-林策");
B.setViewer("评委-周筑");
C.setViewer("主办方");
await new Promise((r) => setTimeout(r, 30)); // 让 storage 事件送达

// ---- 两个评委对每个方案提交评分 ----
for (const sid of ["a", "b", "c"]) {
  A.record(sid); B.record(sid);
  A.submit(sid, { site: 80, program: 80, structure: 80, sustain: 80 }, "林策意见足够字数", false, 0);
  await new Promise((r) => setTimeout(r, 20));
  const bv = B.scores.find((s) => s.schemeId === sid)?.version ?? 0;
  B.submit(sid, { site: 70, program: 70, structure: 70, sustain: 70 }, "周筑意见足够字数", false, bv);
  await new Promise((r) => setTimeout(r, 20));
}
// B 标签页在 storage 事件后应看到 A 的提交
assert(B.allSubmittedFor("a"), "跨标签页提交状态同步，方案 a 全部提交");

// ---- 场景 1：登记依据 → 退出排名；有效评委不足 2 → 样本不足；复核后恢复 ----
// 主办方在 S-01 对林策登记利益关系依据（锁定前）
assert(C.registerReview("评委-林策", "a", "评分提交后收到说明：林策与该设计单位有项目合作"), "主办方登记复核依据成功");
await new Promise((r) => setTimeout(r, 20));
let row = C.liveSplit.insufficient.find((r) => r.schemeId === "a");
assert(!!row && row.judgeCount === 1, "待处理期间该评分退出排名，S-01 有效评委仅 1 人 → 样本不足");
assert(row.excluded.some((e) => e.judge === "评委-林策" && e.reason === "待处理"), "退出原因登记为“待处理”");
assert(C.currentReviewState("评委-林策", "a") === "待处理", "复核状态为待处理");

const reviewId = C.reviews.find((r) => r.judge === "评委-林策" && r.schemeId === "a").id;
C.completeReview(reviewId, "复核通过，关系说明不影响本评分");
await new Promise((r) => setTimeout(r, 20));
assert(C.currentReviewState("评委-林策", "a") === "已复核", "复核通过");
row = C.liveSplit.ranked.find((r) => r.schemeId === "a");
assert(!!row && row.judgeCount === 2, "复核后评分恢复，S-01 有效评委回到 2 人并进入排名");

// ---- 场景 2：复核期间/复核后评分被改动 → 旧复核失效，重新核对 ----
// 林策退回修改再提交（版本变化）
A.recalled("a");
await new Promise((r) => setTimeout(r, 20));
assert(C.currentReviewState("评委-林策", "a") === "待重新核对", "评分退回改动后，旧复核失效 → 待重新核对");
const av = A.scores.find((s) => s.schemeId === "a").version;
A.submit("a", { site: 90, program: 90, structure: 90, sustain: 90 }, "林策修改后意见足够字数", false, av);
await new Promise((r) => setTimeout(r, 20));
assert(C.currentReviewState("评委-林策", "a") === "待重新核对", "重新提交新版本后仍为待重新核对");
// 重新核对期间应再次退出排名
row = C.liveSplit.insufficient.find((r) => r.schemeId === "a");
assert(!!row, "重新核对期间评分再次退出排名，S-01 再次样本不足");
const rev2 = C.reviews.filter((r) => r.judge === "评委-林策" && r.schemeId === "a").slice(-1)[0];
C.completeReview(rev2.id, "重新核对通过");
await new Promise((r) => setTimeout(r, 20));
assert(C.currentReviewState("评委-林策", "a") === "已复核", "重新核对后恢复已复核");

// ---- 场景 3：锁定，固化快照 ----
// 在 S-02 给周筑登记一个不复核的待处理，锁定时应退出 + 样本不足
C.registerReview("评委-周筑", "b", "周筑与参赛单位有师生关系，待核实");
await new Promise((r) => setTimeout(r, 20));
C.publish();
assert(C.published, "结果锁定");
const snapB = C.snapshot.insufficient.find((r) => r.schemeId === "b");
assert(!!snapB && snapB.judgeCount === 1, "锁定瞬间 S-02 待处理评分退出，固化为样本不足");
const snapARanked = C.snapshot.ranked.find((r) => r.schemeId === "a");
assert(!!snapARanked && snapARanked.judgeCount === 2, "S-01 在锁定版本中以 2 名有效评委进入正式排名");

// ---- 场景 4：锁定后新登记只生成待更正，原排名/快照不变 ----
const rankedBefore = JSON.stringify(C.snapshot.ranked);
assert(C.registerReview("评委-林策", "c", "锁定后收到举报，林策存在未披露关系"), "锁定后可继续登记");
await new Promise((r) => setTimeout(r, 20));
const corr = C.correctionReviews;
assert(corr.some((r) => r.schemeId === "c" && r.judge === "评委-林策" && r.status === "待更正"), "锁定后登记生成“待更正”记录");
assert(JSON.stringify(C.snapshot.ranked) === rankedBefore, "锁定版本排名不被待更正记录改变");
// 主办方 tab 收到事件后也应看到待更正
await new Promise((r) => setTimeout(r, 20));
assert(A.scores.find((s) => s.schemeId === "c")?.submitted === true, "评委 tab 仍可读到锁定数据快照");

// ---- 场景 5：两个标签页同时改同一评分，后保存者看到已更新，两版修订并存 ----
// tabB（周筑）先打开 S-03，基线 v1；随后打开 tabD（同为周筑），D 先收到的也是 v1
const scoreC_B = B.scores.find((s) => s.schemeId === "c");
const baseB = scoreC_B.version;
const useD = await makeStoreContext("tabD", backends, listeners);
const piniaD = createPinia();
const D = useD(piniaD);
D.setViewer("评委-周筑");
await new Promise((r) => setTimeout(r, 30));
const scoreC_D = D.scores.find((s) => s.schemeId === "c");
const baseD = scoreC_D.version;
assert(baseB === baseD && baseB === 1, `两个标签页基于同一版本 v${baseB} 打开评分`);
// B 先保存草稿；S-03 已提交，草稿被拦截，因此用 submit 覆盖（模拟退回后再提交的改动）
const out1 = B.submit("c", { site: 50, program: 50, structure: 50, sustain: 50 }, "B标签页先保存的意见内容", false, baseB);
assert(out1.ok && !out1.conflict && out1.version === baseB + 1, "先保存者正常写入新版本");
await new Promise((r) => setTimeout(r, 30));
// D 不刷新表单，基于旧版本 v1 再保存 → 必须被提示已更新
const out2 = D.submit("c", { site: 95, program: 95, structure: 95, sustain: 95 }, "D标签页后保存的意见内容", false, baseD);
assert(out2.conflict === true, "后保存者收到 conflict=true，得知评分已被另一标签页更新");
await new Promise((r) => setTimeout(r, 30));
const finalB = B.scores.find((s) => s.schemeId === "c");
assert(finalB.version === baseB + 2, "后保存再产生一个新版本");
const revs = finalB.revisions;
assert(revs.some((r) => r.values.site === 50), "先保存标签页的那一版（50 分）保留在修订历史");
assert(finalB.values.site === 95, "当前版本是后保存标签页的内容（95 分）");
const historyVersions = new Set([finalB.version, ...revs.map((r) => r.version)]);
assert(historyVersions.size === revs.length + 1, "修订版本号互不重复，两版修订均留痕");
// D 本地也应通过 storage 事件收敛到同一状态
await new Promise((r) => setTimeout(r, 30));
const finalD = D.scores.find((s) => s.schemeId === "c");
assert(finalD.version === finalB.version && finalD.revisions.length === finalB.revisions.length, "先保存的标签页也收到后保存版本，两端最终一致");

// ---- 额外：利益冲突勾选仍退出排名（旧能力不回归）----
// 新方案全部已锁定，无法改；直接检查 liveRows 口径对 conflict 的处理（用锁定前快照不可改，改用 isExcluded）
const conflictScore = { id: "x", judge: "评委-林策", schemeId: "a", values: {}, comment: "", submitted: true, conflict: true, updatedAt: "", version: 1, source: "t", revisions: [] };
assert(C.isExcluded(conflictScore).excluded === true, "声明利益冲突的评分仍退出排名（旧规则保持）");

console.log("\n完成");
