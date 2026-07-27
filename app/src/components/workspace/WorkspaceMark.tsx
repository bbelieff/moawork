"use client";

import { useState } from "react";
import styles from "./workspace-switcher.module.css";

const MARK_TONES = ["toneRecord", "toneAutomation", "tonePrimary"] as const;

export type WorkspaceMarkProps = {
  name: string;
  /** 서버가 권한을 확인해 발급한 짧은 수명의 서명 URL만 전달한다. */
  signedImageUrl?: string | null;
  size?: number;
  muted?: boolean;
  decorative?: boolean;
};

const LEGAL_FORM =
  /(유한책임회사|주식회사|유한회사|재단법인|사단법인|합자회사|합명회사|\(주\)|\(유\)|\(재\)|\(사\)|㈜|㈕)/giu;

export function workspaceInitial(name: string): string | null {
  const normalized = name.normalize("NFKC");
  const stripped = normalized.replace(LEGAL_FORM, " ").trim();
  const source = stripped || normalized;
  const characters = Array.from(source).filter((character) =>
    /[\p{L}\p{N}]/u.test(character),
  );

  if (characters.length === 0) return null;
  if (/[가-힣]/u.test(characters[0])) return characters[0];
  return characters.slice(0, 2).join("").toLocaleUpperCase("en-US");
}

export function workspaceNameHash(value: string): number {
  let hash = 0;
  for (const character of value.normalize("NFKC")) {
    hash = Math.imul(hash, 31) + (character.codePointAt(0) ?? 0);
  }
  return hash >>> 0;
}

export function workspaceTone(name: string): (typeof MARK_TONES)[number] {
  return MARK_TONES[workspaceNameHash(name) % MARK_TONES.length];
}

export function WorkspaceMark({
  name,
  signedImageUrl = null,
  size = 32,
  muted = false,
  decorative = true,
}: WorkspaceMarkProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const initial = workspaceInitial(name);
  const tone = workspaceTone(name);

  return (
    <span
      className={[styles.mark, styles[tone], muted ? styles.markMuted : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        flexBasis: size,
        fontSize: Math.round(size * 0.4),
      }}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${name} 회사 표식`}
    >
      {signedImageUrl && failedImageUrl !== signedImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 짧게 만료되는 서명 URL은 최적화 대상이 아니다.
        <img
          src={signedImageUrl}
          alt=""
          className={styles.markImage}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedImageUrl(signedImageUrl)}
        />
      ) : initial ? (
        <span>{initial}</span>
      ) : (
        <span className={styles.markFallback} data-mark-fallback="brand" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}
