<script setup lang="ts">
// Tickets 31 and 39: a sticky segmented control that splits a long page into short views.
// Each tab is a link, so the choice lives in the URL (#page/tab) and back, forward, and reload keep it.
defineProps<{ page: string; tabs: Array<{ id: string; label: string }>; active: string; label: string }>();
</script>

<template>
  <nav class="page-tabs" :aria-label="label">
    <a v-for="tab in tabs" :key="tab.id" :href="`#${page}/${tab.id}`" :aria-current="tab.id === active ? 'page' : undefined">{{ tab.label }}</a>
  </nav>
</template>
