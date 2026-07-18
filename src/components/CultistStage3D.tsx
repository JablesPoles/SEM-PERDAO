'use client';
/**
 * CultistStage3D — o provador: renderiza o SEU cultista com o modelo real da
 * mesa (vitrineReu). Usado no menu (criação de personagem) e no lobby ritual.
 * Arrastar gira; parado, ele gira sozinho e muda de cara.
 */
import { useEffect, useRef } from 'react';
import type { CultistAppearance } from '@/lib/types';
import type { VitrineReu } from '@/lib/three/vitrineReu';

interface Props {
  nome: string;
  aparencia: CultistAppearance;
  /** Incremente para o réu comemorar (sorteio/selo aceso). */
  celebrarSinal?: number;
  className?: string;
}

export function CultistStage3D({ nome, aparencia, celebrarSinal = 0, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vitrineRef = useRef<VitrineReu | null>(null);
  // guarda o último pedido pra aplicar assim que a cena async terminar de subir
  const pedidoRef = useRef({ nome, aparencia });

  useEffect(() => {
    let viva = true;
    let observer: ResizeObserver | null = null;
    (async () => {
      await document.fonts.ready; // crachá 3D usa a fonte real
      if (!viva || !canvasRef.current) return;
      const { VitrineReu } = await import('@/lib/three/vitrineReu');
      if (!viva || !canvasRef.current) return;
      const vitrine = new VitrineReu(canvasRef.current);
      vitrineRef.current = vitrine;
      vitrine.setReu(pedidoRef.current.nome, pedidoRef.current.aparencia);
      observer = new ResizeObserver(() => vitrine.resize());
      observer.observe(canvasRef.current);
    })();
    return () => {
      viva = false;
      observer?.disconnect();
      vitrineRef.current?.dispose();
      vitrineRef.current = null;
    };
  }, []);

  useEffect(() => {
    pedidoRef.current = { nome, aparencia };
    vitrineRef.current?.setReu(nome, aparencia);
  }, [nome, aparencia]);

  useEffect(() => {
    if (celebrarSinal > 0) vitrineRef.current?.celebrar();
  }, [celebrarSinal]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ imageRendering: 'pixelated', touchAction: 'pan-y', cursor: 'grab' }}
      aria-label={`Prévia 3D do cultista ${nome}`}
    />
  );
}
