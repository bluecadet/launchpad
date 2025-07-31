<script setup lang="ts">
const _props = defineProps<{
	package: "string";
	href: "string";
	description: "string";
}>();
</script>

<template>
  <li>
    <a :href="href" class="card">
      <h3>@bluecadet/launchpad-{{ package }}</h3>
      <p>{{ description }}</p>
      <Badge type="tip" :text="'v' + packageVersions[package]" />
    </a>
  </li>
</template>

<style scoped>
  li {
    margin: 0 !important;
  }

  .card {
    display: flex;
    border: 1px solid var(--vp-c-bg-soft);
    height: 100%;
    background-color: var(--vp-c-bg-soft);
    transition: border-color .25s,background-color .25s;
    flex-direction: column;
    padding: 24px;
    border-radius: 12px;
    color: inherit;
    text-decoration: none;
    align-items: start;
    
  }

  .card:hover {
    border-color: var(--vp-c-brand-1);
    color: inherit;
  }

  .card h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .card p {
    margin: 0;
    font-size: 1rem;
    font-weight: 400;
    color: var(--vp-c-text-2);
    line-height: 1.4;
    margin-top: 0.5em;
    margin-bottom: 1em;
  }
</style>