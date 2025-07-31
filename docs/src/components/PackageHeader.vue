<script setup lang="ts">
import { GitCommitVertical, Github, Hexagon, Logs } from "lucide-vue-next";

import { data as packageVersions } from "./package-versions.data.js";

console.log(packageVersions);

const props = defineProps<{
	package: "string";
}>();
</script>

<template>
  <h1 v-if="package === 'launchpad'"><span class="package-base">@bluecadet/</span>launchpad</h1>
  <h1 v-else><span class="package-base">@bluecadet/</span>launchpad-{{ package }}</h1>

  <ul>
    <li class="version"><GitCommitVertical size="18"/> v{{ packageVersions[package] }}</li>
    <li class="link">
      <a :href="`https://github.com/bluecadet/launchpad/tree/develop/packages/${package}`" target="_blank" rel="noopener noreferrer">
        <Github size="18"/> github
      </a>
    </li>
    <li class="link">
      <a :href="`https://www.npmjs.com/package/@bluecadet/${package === 'launchpad' ? '' : 'launchpad-'}${package}`" target="_blank" rel="noopener noreferrer">
        <Hexagon size="18"/> npm
      </a>
    </li>
    <li class="link">
      <a :href="`https://github.com/bluecadet/launchpad/tree/develop/packages/${package}/CHANGELOG.md`" target="_blank" rel="noopener noreferrer">
        <Logs size="18"/> changelog
      </a>
    </li>
  </ul>
</template>

<style scoped>

h1 {
  font-size: 2.5rem;
}

h1 .package-base {
  font-weight: normal;
  color: var(--vp-c-text-2);
}

ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  list-style-type: none !important;
  align-items: baseline;
  padding: 0 !important;
  margin-bottom: 1.2rem;
}

li {
  margin: 0 !important;
  padding: 0;
}

a {
  text-decoration: none !important;
}

li.version, li.link a {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

li.version > svg {
  /* this icon is skinny, so shave off the edges */
  margin-inline: -0.2rem; 
}

</style>