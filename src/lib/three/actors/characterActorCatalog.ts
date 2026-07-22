import { createActorCatalog } from '@/lib/mesa/actorCatalog';
import { PROCEDURAL_CULTIST_MANIFEST } from './cultistManifest';

export const RIGGED_CULTIST_MANIFEST_URL = '/mesa/actors/sem-perdao.cultist.gltf-v1/1/manifest.json';

/**
 * Registro de fontes do Character Lab. Acrescentar um glTF novo exige somente
 * publicar seu diretório/manifesto e registrar a URL aqui; o Scene não muda.
 */
export const CHARACTER_ACTOR_CATALOG = createActorCatalog({
  defaultActorId: PROCEDURAL_CULTIST_MANIFEST.id,
  entries: [
    {
      id: PROCEDURAL_CULTIST_MANIFEST.id,
      label: PROCEDURAL_CULTIST_MANIFEST.label,
      runtime: 'procedural',
      availability: 'bundled',
      description: 'Fallback gerado em Three.js; sempre disponível e customizável.',
      source: {
        kind: 'inline-manifest',
        manifest: PROCEDURAL_CULTIST_MANIFEST,
      },
    },
    {
      id: 'sem-perdao.cultist.gltf-v1',
      label: 'Cultista glTF · slot v1',
      runtime: 'gltf',
      availability: 'on-demand',
      description: 'Slot rigado: usa o GLB quando publicado e volta ao procedural se faltar.',
      fallbackActorId: PROCEDURAL_CULTIST_MANIFEST.id,
      source: {
        kind: 'manifest-url',
        url: RIGGED_CULTIST_MANIFEST_URL,
      },
    },
  ],
});
