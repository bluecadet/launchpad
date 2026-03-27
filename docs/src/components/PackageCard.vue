<script setup lang="ts">
import { data as packageVersions } from "./package-versions.data.js";

const props = defineProps<{
	package: "string";
	href: "string";
	description: "string";
}>();
</script>

<template>
  <li>
    <a :href="href" class="card custom-block note">
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
    height: 100%;
    transition: border-color .2s,background-color .2s;
    flex-direction: column;
    padding: 18px 24px;
    color: inherit;
    text-decoration: none;
    align-items: start;
    margin: 0;
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