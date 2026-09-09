/**
 * Browser와 server action이 함께 쓰는 파일 업로드의 순수 크기 계약.
 *
 * 이 파일에는 저장소·서버 모듈 의존성을 추가하지 않는다. 클라이언트 컴포넌트가
 * `services/files`의 `getRepo()` 그래프를 실수로 번들에 끌어들이지 않게 분리했다.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
