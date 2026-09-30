<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useReviewStore } from "../stores/review";
import type { ReviewState } from "../types";
import { formatTime } from "../utils/time";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const defaultValues = () => Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>;
const form = reactive({ values: defaultValues(), comment: "", conflict: false });
const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

/** 表单所依据的评分版本；另一标签页先保存会使它落后于当前版本 */
const baseVersion = ref(0);
const versionLoadedAt = ref(new Date().toISOString());

function loadForm() {
  const item = store.record(selected.value.id);
  form.values = { ...(item?.values ?? defaultValues()) };
  form.comment = item?.comment ?? "";
  form.conflict = item?.conflict ?? false;
  baseVersion.value = item?.version ?? 0;
  versionLoadedAt.value = new Date().toISOString();
}

watch(selectedId, loadForm, { immediate: true });

/** 另一标签页在本标签页加载表单之后保存了同一评分 */
const updatedElsewhere = computed(() => {
  const item = currentScore.value;
  return Boolean(item && item.version > baseVersion.value && item.updatedAt > versionLoadedAt.value);
});

const reviewState = computed<ReviewState | null>(() =>
  store.judge ? store.currentReviewState(store.judge, selected.value.id) : null);

const revisions = computed(() => {
  const item = currentScore.value;
  if (!item) return [];
  return [item, ...item.revisions].slice(0, 6);
});

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || currentScore.value?.submitted || store.published);

function draft() {
  const outcome = store.saveDraft(selected.value.id, form.values, form.comment, form.conflict, baseVersion.value);
  if (!outcome.ok) return;
  baseVersion.value = outcome.version;
  versionLoadedAt.value = new Date().toISOString();
  if (outcome.conflict) {
    message.warning("该评分已在另一标签页被更新：对方版本已保留为修订，你的修改另存为新版本，可在下方比对两版。");
  } else {
    message.success("评分草稿已保存到本地");
  }
}
async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  const outcome = store.submit(selected.value.id, form.values, form.comment, form.conflict, baseVersion.value);
  baseVersion.value = outcome.version;
  versionLoadedAt.value = new Date().toISOString();
  if (outcome.conflict) {
    message.warning("该评分已在另一标签页被更新：对方版本已保留为修订，你的提交另存为新版本，可在下方比对两版。");
  } else {
    message.success("匿名评分已提交");
  }
}

const reviewTagType: Record<ReviewState, "warning" | "success" | "error" | "info"> = {
  待处理: "warning", 待重新核对: "error", 已复核: "success", 待更正: "info"
};
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>主办方在结果锁定前不能查看任何评委的评分值。</NAlert>
  <NAlert v-else-if="reviewState === '待处理'" type="warning" show-icon class="state-alert">
    主办方已登记利益关系依据，本评分正在复核中，复核完成前暂退出排名。
  </NAlert>
  <NAlert v-else-if="reviewState === '待重新核对'" type="error" show-icon class="state-alert">
    评分版本在复核期间被改动，原复核已失效，主办方需依据当前版本重新核对。
  </NAlert>
  <NAlert v-else-if="reviewState === '已复核'" type="success" show-icon class="state-alert">
    本评分已经复核通过并恢复进入排名（绑定提交版本，再次改动将重新核对）。
  </NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel"><button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id"><span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ item.status }}</small></button></NCard>
    <NCard class="score-panel">
      <template #header><div class="card-title"><div><small>{{ selected.code }} · {{ selected.publicNo }}</small><h2>{{ selected.title }}</h2></div><div class="header-tags"><NTag v-if="reviewState" :type="reviewTagType[reviewState]">{{ reviewState }}</NTag><NTag :type="selected.status === '已锁定' ? 'success' : 'warning'">{{ selected.status }}</NTag></div></div></template>
      <p class="synopsis">{{ selected.synopsis }}</p>
      <NAlert v-if="updatedElsewhere && !store.isOrganizer" type="warning" show-icon class="state-alert">
        该评分在另一标签页已被更新（当前 v{{ currentScore?.version }}）。继续保存会同时保留两版修订；也可先在下方查看对方版本。
      </NAlert>
      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id"><div><b>{{ item.name }}</b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div><NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" /><small>{{ form.values[item.id] }} / {{ item.max }}</small></article>
      </div>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch"><NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span></label>
      <label class="field"><span>评审意见（评委间不可见）</span><NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" /><small>{{ errors.comment }}</small></label>
      <div class="actions"><NButton :disabled="disabled" @click="draft">保存草稿</NButton><NButton type="primary" :disabled="disabled" @click="submit">提交本方案评分</NButton><NButton v-if="currentScore?.submitted && !store.published" quaternary @click="store.recalled(selected.id)">退回修改</NButton><small v-if="currentScore" class="version-hint">当前版本 v{{ currentScore.version }}</small></div>
      <section v-if="!store.isOrganizer && revisions.some((rev) => rev.version > 0)" class="revisions">
        <h4>修订历史（含其它标签页并存版本）</h4>
        <article v-for="rev in revisions" :key="`${rev.version}-${rev.updatedAt}`" class="revision-row">
          <div><b>v{{ rev.version }}</b><small>{{ formatTime(rev.updatedAt) }} · 标签页 {{ rev.source }}{{ rev === currentScore ? " · 当前" : "" }}</small></div>
          <span :class="{ conflicted: rev.conflict }">{{ rev.conflict ? "已声明利益冲突" : rev.submitted ? "已提交" : "草稿" }}</span>
          <b>{{ store.criteria.reduce((sum, item) => sum + (rev.values[item.id] ?? 0) * item.weight / 100, 0).toFixed(1) }} 分</b>
        </article>
      </section>
    </NCard>
  </div>
</template>
