<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const form = reactive({ values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>, comment: "", conflict: false });
const baseVersion = ref<number>(1);
const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

function loadFromScore() {
  const record = store.record(selected.value.id);
  form.values = { ...(record?.values ?? Object.fromEntries(store.criteria.map((item) => [item.id, 60]))) };
  form.comment = record?.comment ?? "";
  form.conflict = record?.conflict ?? false;
  baseVersion.value = record?.version ?? 1;
}

watch(selectedId, loadFromScore, { immediate: true });

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || currentScore.value?.submitted || store.published);
const review = computed(() => (currentScore.value ? store.reviewForScore(currentScore.value.id) : undefined));
const revisionCount = computed(() => currentScore.value?.revisions?.length ?? 0);

function draft() {
  const result = store.saveDraft(selected.value.id, form.values, form.comment, form.conflict, baseVersion.value);
  if (result.status === "conflict" && result.latest) {
    message.warning("该评分已被其他标签页更新，已为你载入最新版本，请基于最新内容再保存");
    form.values = { ...result.latest.values };
    form.comment = result.latest.comment;
    form.conflict = result.latest.conflict;
    baseVersion.value = result.latest.version;
    return;
  }
  if (result.score) baseVersion.value = result.score.version;
  message.success("评分草稿已保存到本地");
}
async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  const saveResult = store.submit(selected.value.id, form.values, form.comment, form.conflict, baseVersion.value);
  if (saveResult.status === "conflict" && saveResult.latest) {
    message.warning("该评分已被其他标签页更新，已为你载入最新版本，请核对后重新提交");
    form.values = { ...saveResult.latest.values };
    form.comment = saveResult.latest.comment;
    form.conflict = saveResult.latest.conflict;
    baseVersion.value = saveResult.latest.version;
    return;
  }
  if (saveResult.score) baseVersion.value = saveResult.score.version;
  message.success("匿名评分已提交");
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>主办方在结果锁定前不能查看任何评委的评分值。</NAlert>
  <NAlert v-if="review && review.status === '待处理'" type="warning" show-icon>
    主办方已登记利益关系依据（{{ review.basis }}），本评分在复核期间暂停排名；评分一旦改动，原复核将失效并重新核对。
  </NAlert>
  <NAlert v-if="review && review.status === '已失效'" type="error" show-icon>
    本评分在复核期间被改动，原复核已失效，主办方将按原依据重新核对。
  </NAlert>
  <NAlert v-if="review && review.status === '待更正'" type="info" show-icon>
    结果已锁定，本次利益关系登记列为待更正，不影响已锁定的排名版本。
  </NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel"><button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id"><span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ item.status }}</small></button></NCard>
    <NCard class="score-panel">
      <template #header><div class="card-title"><div><small>{{ selected.code }} · {{ selected.publicNo }}</small><h2>{{ selected.title }}</h2></div><NTag :type="selected.status === '已锁定' ? 'success' : 'warning'">{{ selected.status }}</NTag></div></template>
      <p class="synopsis">{{ selected.synopsis }}</p>
      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id"><div><b>{{ item.name }}</b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div><NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" /><small>{{ form.values[item.id] }} / {{ item.max }}</small></article>
      </div>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch"><NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span></label>
      <label class="field"><span>评审意见（评委间不可见）</span><NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" /><small>{{ errors.comment }}</small></label>
      <div class="actions">
        <NButton :disabled="disabled" @click="draft">保存草稿</NButton>
        <NButton type="primary" :disabled="disabled" @click="submit">提交本方案评分</NButton>
        <NButton v-if="currentScore?.submitted && !store.published" quaternary @click="store.recalled(selected.id)">退回修改</NButton>
        <NTag v-if="revisionCount > 1" type="info" :bordered="false">已保留 {{ revisionCount }} 版修订</NTag>
      </div>
    </NCard>
  </div>
</template>
