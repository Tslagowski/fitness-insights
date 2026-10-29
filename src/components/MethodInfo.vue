<script setup lang="ts">
// Ticket 33: the method version (and any note about it) one tap away instead of on every card.
defineProps<{ label: string; note?: string }>();
</script>

<template>
  <details class="method-info">
    <summary :aria-label="`About this calculation (${label})`"><span aria-hidden="true">i</span></summary>
    <div class="method-pop"><strong>{{ label }}</strong><span v-if="note">{{ note }}</span>
      <span>A repeatable calculation over your eligible saved data: the same data always gives the same result. See "How this is calculated" for the rules.</span></div>
  </details>
</template>
