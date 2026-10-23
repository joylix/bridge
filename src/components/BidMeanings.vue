<script setup lang="ts">
import { computed } from 'vue';
import { describeCall, useGameStore } from '../store/game';
import { sameBidCall, type BidMeaningRow } from '../engine/bidMeaning';

const props = defineProps<{
  /** 当前悬停的叫牌记录；为空时使用叫牌卡悬停/推荐含义 */
  row?: BidMeaningRow | null;
}>();

const store = useGameStore();
const SEAT_LABEL = { N: '北', E: '东', S: '南', W: '西' } as const;

/** 叫牌表悬停优先；否则显示叫牌卡当前悬停叫品（BiddingBox 写入 bidPreview） */
const displayRow = computed<BidMeaningRow | null>(() => {
  if (props.row) return props.row;
  if (store.phase !== 'bidding' || !store.showHints || !store.bidPreview) return null;
  return {
    position: store.bidPreview.position,
    call: store.bidPreview.call,
    meaning: store.bidPreview.meaning,
  };
});

const isRecommended = computed(
  () => !props.row && store.bidPreview?.recommended === true,
);

/** 悬停非推荐叫品时，附带推荐叫品及其含义，替代叫牌卡内原来的推荐区域 */
const recommendation = computed(() => {
  if (props.row) return null;
  const preview = store.bidPreview;
  if (!preview?.recommendedCall || !preview.recommendedMeaning) return null;
  const current = displayRow.value?.call ?? preview.call;
  if (sameBidCall(preview.recommendedCall, current)) return null;
  return { call: preview.recommendedCall, meaning: preview.recommendedMeaning };
});
</script>

<template>
  <aside v-if="displayRow" class="bid-meanings" aria-label="叫牌含义">
    <div class="bm-call-line">
      <span class="bm-seat">{{ SEAT_LABEL[displayRow.position] }}</span>
      <span class="bm-call">{{ describeCall(displayRow.call) }}</span>
      <span v-if="isRecommended" class="bm-tag">推荐</span>
    </div>
    <p class="bm-text">{{ displayRow.meaning }}</p>

    <div v-if="recommendation" class="bm-recommendation">
      <span class="bm-rec-label">推荐</span>
      <span class="bm-rec-call">{{ describeCall(recommendation.call) }}</span>
      <span class="bm-rec-text">{{ recommendation.meaning }}</span>
    </div>
  </aside>
</template>

<style scoped>
/* 浅青薄纱文字层：位于中央叫牌记录右侧，只轻微压住记录区右边 */
.bid-meanings {
  position: absolute;
  left: calc(100% - 20px);
  top: 50%;
  z-index: 30;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  width: clamp(220px, 18vw, 280px);
  min-height: 112px;
  padding: 16px 20px;
  transform: translateY(-50%);
  border: 0;
  border-radius: 16px;
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.48) 0%,
    rgba(228, 251, 247, 0.42) 58%,
    rgba(210, 246, 241, 0.38) 100%
  );
  box-shadow: 0 12px 28px rgba(4, 40, 30, 0.14);
  color: #123d34;
  backdrop-filter: blur(8px) saturate(1.05);
  pointer-events: none;
}
.bm-call-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bm-seat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(29, 128, 104, 0.14);
  color: #176b59;
  font-size: 12px;
  font-weight: 700;
}
.bm-call {
  color: #075947;
  font-size: 21px;
  font-weight: 800;
  letter-spacing: 0.01em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
}
.bm-tag,
.bm-rec-label {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: rgba(24, 138, 85, 0.16);
  color: #0d6b3f;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.bm-text {
  margin: 0;
  color: #235247;
  font-size: 13px;
  line-height: 1.6;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.45);
}
.bm-recommendation {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px solid rgba(18, 92, 72, 0.14);
  color: #235247;
  font-size: 12px;
  line-height: 1.5;
}
.bm-rec-call {
  color: #075947;
  font-size: 14px;
  font-weight: 800;
}
.bm-rec-text {
  flex: 1 1 100%;
  color: #2b5a4e;
}

@media (max-width: 880px) {
  .bid-meanings {
    left: 50%;
    width: min(300px, 92%);
    transform: translate(-50%, -50%);
  }
}
</style>
