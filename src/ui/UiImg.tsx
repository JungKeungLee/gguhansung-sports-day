import { type ReactNode, useState } from 'react';
import { type UiImage, uiUrl } from '../game/images';

/** public/ui 이미지 공통 컴포넌트 — 로드 실패 시 fallback(기본: 표시 안 함)으로 대체 */
export function UiImg({ name, className, alt = '', fallback = null }: {
  name: UiImage; className?: string; alt?: string; fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img className={`ui-img${className ? ` ${className}` : ''}`} src={uiUrl(name)} alt={alt} draggable={false} onError={() => setFailed(true)} />;
}
