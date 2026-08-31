"use client";

/**
 * 로고를 실제로 줄인다 (#652).
 *
 * «얼마나 줄일지» 는 compress-plan.ts 가 정하고(순수·검사 가능), 여기는 그 계획을
 * canvas 로 실행만 한다. 브라우저 없이는 못 도는 부분만 남긴다.
 *
 * ★ 실패하면 «원본을 그대로» 돌려준다. 압축은 편의지 관문이 아니다 —
 *   여기서 던지면 「그림은 멀쩡한데 못 올리는」 상태가 된다.
 */

import {
  planLogoCompression,
  shouldUseCompressed,
  type CompressPlan,
} from "./compress-plan";

export type CompressResult = {
  file: File;
  /** 원본 크기. 「3.2MB → 180KB」 를 보여 주려면 둘 다 필요하다. */
  originalBytes: number;
  compressed: boolean;
};

function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      // 못 읽었으면 «모른다» 로 돌려준다 — 계획 함수가 그때 손대지 않기로 정한다.
      resolve({ width: 0, height: 0 });
    };
    image.src = url;
  });
}

function draw(file: File, plan: Extract<CompressPlan, { kind: "resize" }>): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = plan.width;
        canvas.height = plan.height;
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        // ★ PNG 의 투명 배경을 지키려면 흰색을 깔면 안 된다. 그대로 그린다.
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, plan.width, plan.height);
        canvas.toBlob((blob) => resolve(blob), file.type, plan.quality);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/** 고른 파일을 «권장 크기에 맞춰» 줄인다. 못 줄이면 원본 그대로. */
export async function compressOrgLogo(file: File): Promise<CompressResult> {
  const originalBytes = file.size;
  const asIs: CompressResult = { file, originalBytes, compressed: false };
  if (typeof document === "undefined") return asIs;

  const { width, height } = await readDimensions(file);
  const plan = planLogoCompression({ mime: file.type, bytes: originalBytes, width, height });
  if (plan.kind === "as_is") return asIs;

  const blob = await draw(file, plan);
  if (!blob || !shouldUseCompressed(originalBytes, blob.size)) return asIs;

  return {
    file: new File([blob], file.name, { type: file.type, lastModified: file.lastModified }),
    originalBytes,
    compressed: true,
  };
}
