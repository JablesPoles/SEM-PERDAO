import type { Metadata } from 'next';
import { ModelGallery } from '@/components/dev/ModelGallery';

export const metadata: Metadata = {
  title: 'Acervo 3D — A Mesa Engine',
  description: 'Vitrine dos modelos gerados no Blender: cultista modular e props do tribunal.',
  robots: { index: false, follow: false },
};

export default function ModelGalleryPage() {
  return <ModelGallery />;
}
