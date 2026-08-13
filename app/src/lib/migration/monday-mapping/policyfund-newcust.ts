/** 정책자금 업종의 역사 이관 매핑 사전이다. 실측 출처는 서울경영지원센터 먼데이 원본이며, 제품 기본 구조의 정본은 docs/design/UI목업_워크스페이스_최종_v6.html 이다. */
/**
 * 서울경영지원센터 `🔥신규고객` 보드 구조 — 먼데이 실측 2026-08-05.
 *
 * 원본: monday board `1816794539`. 컬럼 key 는 먼데이 컬럼 id 를 그대로 쓴다
 * (라벨을 slug 로 바꾸면 먼데이 쪽에서 라벨이 바뀔 때 대응이 끊긴다).
 * 선택지 id 는 라벨 그대로 — 002 팩의 확립된 규약이다(먼데이는 라벨=값).
 *
 * 컬럼 순서·그룹 순서·라벨 hex 색은 실측값이며 임의로 바꾸지 않는다.
 */

import type { PackBoard } from "./types";

/** 먼데이 grey — "값 없음" 자리의 공통 색. */
const GREY = "#c4c4c4";

export const POLICYFUND_NEWCUST_BOARD: PackBoard = {
  slug: "newcust",
  name: "🔥신규고객",
  icon: "🔥",
  description: "신규 상담 원장 — 유입부터 컨텍관리 이동까지",
  mondayBoardId: "1816794539",

  // 시드 확정 ①: Name = 업체명. 먼데이의 중복 `회사명`(text_mm2czkqg) 컬럼은 심지 않는다
  // → 먼데이 28컬럼 = 팩 27(Name 1 + 설치 24 + 유예 2) + 제거 1.
  nameColumn: { label: "업체명", mondayLabel: "Name" },

  columns: [
    { key: "___1", label: "신청일", type: "date", width: 120 },
    { key: "text_mm40jz80", label: "광고 명", type: "text", width: 120 },
    { key: "text_mkz0gcyr", label: "사업자 유형", type: "text", width: 110 },
    // 먼데이 원본이 text 다(숫자 아님). 동일 복제 원칙에 따라 그대로 둔다 —
    // 교정은 먼데이-구조-스펙 §7 교정 대상이며 임의로 바꾸지 않는다.
    { key: "___88", label: "매출액", type: "text", width: 110 },
    { key: "text8", label: "연락처", type: "text", width: 130 },
    { key: "file", label: "파일", type: "file", width: 90 },
    { key: "dup__of____", label: "대표자명", type: "text", width: 100 },
    { key: "___8", label: "주소", type: "text", width: 180 },
    { key: "email_mm40x2jr", label: "이메일", type: "email", width: 160 },
    { key: "___14", label: "출동", type: "person", width: 110 },
    {
      key: "color_mm3acc4d",
      label: "📬부재 메세지",
      type: "select",
      width: 130,
      options: [
        { id: "1번 부재", label: "1번 부재", color: "#fdab3d", order: 0 },
        { id: "2번 부재", label: "2번 부재", color: "#007eb5", order: 1 },
        { id: "3번 부재", label: "3번 부재", color: "#df2f4a", order: 2 },
        { id: "4번 부재", label: "4번 부재", color: "#00c875", order: 3 },
        { id: "1일 1회 전화", label: "1일 1회 전화", color: GREY, order: 4 },
      ],
    },
    {
      key: "color3",
      label: "📬악성부재 메세지전달",
      type: "select",
      width: 150,
      options: [
        { id: "보내기 전", label: "보내기 전", color: GREY, order: 0 },
        { id: "부재 메세지 전달", label: "부재 메세지 전달", color: "#00c875", order: 1 },
      ],
    },
    // 시드 확정 ③: 담당자는 멤버(사람) 컬럼이다. 먼데이의 선택지형 담당자
    // (`color_mkyeay16` — 직원 실명 2명 + 담당자 미정)는 멤버 계정이 없던 시절의
    // 우회이므로 시드에서 제외한다. 선택지형이면 담당자 탭(WO-3)·복수 배정(WO-4)·
    // 알림이 사람에 붙지 않고, 전역 카탈로그에 특정 고객사 직원 실명이 박힌다.
    // key 는 먼데이에 대응 컬럼이 없어 MoaWork 신설분이다.
    { key: "person", label: "담당자", type: "person", width: 120 },
    { key: "long_text", label: "상담내용", type: "longtext", width: null },
    {
      key: "color",
      label: "📬AI_1차",
      type: "select",
      width: 120,
      options: [
        { id: "1차 상담완료", label: "1차 상담완료", color: "#00c875", order: 0 },
        { id: "보내기 전", label: "보내기 전", color: GREY, order: 1 },
      ],
    },
    {
      key: "status",
      label: "상담 상황",
      type: "select",
      width: 140,
      options: [
        { id: "2차 상담예약", label: "2차 상담예약", color: "#9d50dd", order: 0 },
        { id: "해당안됨", label: "해당안됨", color: "#9aadbd", order: 1 },
        { id: "1차 부재", label: "1차 부재", color: "#007eb5", order: 2 },
        { id: "거절", label: "거절", color: "#df2f4a", order: 3 },
        { id: "2차 부재", label: "2차 부재", color: "#225091", order: 4 },
        { id: "2차 상담완료", label: "2차 상담완료", color: "#66ccff", order: 5 },
        { id: "2차 후 고민", label: "2차 후 고민", color: "#579bfc", order: 6 },
        { id: "계약서 요청", label: "계약서 요청", color: "#00c875", order: 7 },
        { id: "고민", label: "고민", color: "#bb3354", order: 8 },
        { id: "보류", label: "보류", color: "#fdab3d", order: 9 },
        { id: "관리", label: "관리", color: "#cab641", order: 10 },
        { id: "지원사업만 알아봄", label: "지원사업만 알아봄", color: "#ff5ac4", order: 11 },
        { id: "제조업 1차부재", label: "제조업 1차부재", color: "#7f5347", order: 12 },
        { id: "제조업 2차부재", label: "제조업 2차부재", color: "#563e3e", order: 13 },
        { id: "다시 상담", label: "다시 상담", color: "#333333", order: 14 },
        { id: "상담 전", label: "상담 전", color: GREY, order: 15 },
      ],
    },
    {
      key: "dup__of_ai___",
      label: "📬AI_2차 확정",
      type: "select",
      width: 130,
      options: [
        { id: "심사확정", label: "심사확정", color: "#00c875", order: 0 },
        { id: "심사 전", label: "심사 전", color: GREY, order: 1 },
      ],
    },
    {
      key: "color_mkyf3jj6",
      label: "피드백 상황",
      type: "select",
      width: 120,
      options: [
        { id: "피드백 전", label: "피드백 전", color: GREY, order: 0 },
        { id: "피드백 완료", label: "피드백 완료", color: "#00c875", order: 1 },
        { id: "정보보완", label: "정보보완", color: "#fdab3d", order: 2 },
        { id: "서류보완", label: "서류보완", color: "#df2f4a", order: 3 },
      ],
    },
    {
      key: "dup__of_ai_2___",
      label: "📬AI_3차불가",
      type: "select",
      width: 120,
      options: [
        { id: "여부 미정", label: "여부 미정", color: GREY, order: 0 },
        { id: "심사거절", label: "심사거절", color: "#df2f4a", order: 1 },
      ],
    },
    {
      // 이 컬럼이 "컨텍이동"이 되면 컨텍관리 보드로 넘긴다(WO-5 자동 인계 트리거).
      // WO-1 은 구조만 심고 이동 동작은 만들지 않는다.
      key: "__1",
      label: "컨텍관리",
      type: "select",
      width: 120,
      options: [
        { id: "컨텍이동", label: "컨텍이동", color: "#00c875", order: 0 },
        { id: "컨텍 대기", label: "컨텍 대기", color: GREY, order: 1 },
      ],
    },
    {
      key: "color_mkyf3bdg",
      label: "컨텍여부",
      type: "select",
      width: 130,
      options: [
        { id: "생각 중", label: "생각 중", color: "#fdab3d", order: 0 },
        { id: "컨텍관리 이동", label: "컨텍관리 이동", color: "#00c875", order: 1 },
        { id: "거절", label: "거절", color: "#df2f4a", order: 2 },
        { id: "컨텍 이동대기", label: "컨텍 이동대기", color: GREY, order: 3 },
      ],
    },
    // 먼데이 show_time_by_default=true → 시각까지 쓰는 컬럼이라 datetime.
    { key: "date", label: "재 유선상담", type: "datetime", width: 150 },
    { key: "date4", label: "대면미팅", type: "datetime", width: 150 },
    { key: "numeric", label: "계약금", type: "number", width: 110 },
  ],

  deferredColumns: [
    { key: "______", label: "하위 아이템", kind: "subtasks", source: "monday subtasks board 1816856300" },
    { key: "_____", label: "생성 로그", kind: "creation_log" },
  ],

  sections: [
    { name: "신규업체-신규고객", groupName: "💡신규고객", color: "#FFCB00", order: 0 },
    { name: "신규업체-1차 부재", groupName: "🔇1차 부재", color: "#0086c0", order: 1 },
    { name: "신규업체-2차 상담고객", groupName: "🔍2차 상담고객", color: "#9CD326", order: 2 },
    // 담당자별 그룹(D73) — 실명 대신 슬롯. 원본은 직원 실명 2명이 각 그룹명에 박혀 있었다.
    { name: "신규업체-담당자별-1", groupName: "♻️", color: "#757575", order: 3, assigneeSlot: 0 },
    { name: "신규업체-담당자별-2", groupName: "♻️", color: "#007eb5", order: 4, assigneeSlot: 1 },
    { name: "신규업체-제조업 1차 부재", groupName: "제조업 1차 부재", color: "#7f5347", order: 5 },
    { name: "신규업체-제조업 2차 부재", groupName: "제조업 2차 부재", color: "#7f5347", order: 6 },
    { name: "신규업체-2차 부재", groupName: "🔇2차 부재", color: "#579bfc", order: 7 },
    { name: "신규업체-2차 후 고민", groupName: "⏳️2차 후 고민", color: "#9CD326", order: 8 },
    { name: "신규업체-관리", groupName: "⚒️관리(업력 신용 등)", color: "#FFCB00", order: 9 },
    { name: "신규업체-보류", groupName: "📑보류", color: "#FF642E", order: 10 },
    { name: "신규업체-해당안되는 업체", groupName: "⛔️해당안되는 업체", color: GREY, order: 11 },
    { name: "신규업체-거절", groupName: "🚫거절", color: "#FF158A", order: 12 },
    { name: "신규업체-지원사업만", groupName: "🔅지원사업만", color: "#9cd326", order: 13 },
  ],

  // 담당자별 탭(전체·담당자A·담당자B·미배정)은 WO-3 소유다. 시드 확정 ③ 으로
  // 담당자가 멤버 컬럼이 됐으므로 그 탭은 라벨이 아니라 멤버 id 로 걸어야 하고,
  // 멤버는 조직마다 다르다 — 전역 팩에 직원 실명을 박아 심을 수 없다.
  views: [{ name: "전체", kind: "table", shared: true }],
};
