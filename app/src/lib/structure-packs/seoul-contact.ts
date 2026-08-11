/**
 * 서울경영지원센터 `🔥컨텍관리` 보드 구조 — 먼데이 실측 2026-08-05.
 *
 * 원본: monday board `1816794566`. 규약은 `seoul-newcust.ts` 와 같다.
 * 지역·사업자유형은 002 팩의 전역 선택지(`field_presets`)를 참조한다 —
 * 218/9 항목을 여기 다시 적으면 002 와 어긋날 여지가 생긴다.
 */

import type { PackBoard } from "./types";

const GREY = "#c4c4c4";

export const SEOUL_CONTACT_BOARD: PackBoard = {
  slug: "contact",
  name: "🔥컨텍관리",
  icon: "🔥",
  description: "계약 직전 단계 — 미팅·계약금·업무관리 인계",
  mondayBoardId: "1816794566",

  // 시드 확정 ①: Name = 업체명. 중복 `회사명`(___67) 제외
  // → 먼데이 25컬럼 = 팩 23(Name 1 + 설치 21 + 유예 1) + 제거 2(회사명·담당자 구분).
  nameColumn: { label: "업체명", mondayLabel: "Name" },

  columns: [
    { key: "text_mm40wa7d", label: "광고 명", type: "text", width: 120 },
    { key: "person", label: "담당자", type: "person", width: 110 },
    { key: "___13", label: "신청일", type: "date", width: 120 },
    { key: "file", label: "파일", type: "file", width: 90 },
    { key: "____", label: "연락처", type: "phone", width: 130 },
    {
      key: "color_mkyf7hr3",
      label: "업종/업태",
      type: "select",
      width: 140,
      options: [
        { id: "제조업", label: "제조업", color: "#fdab3d", order: 0 },
        { id: "도소매업", label: "도소매업", color: "#00c875", order: 1 },
        { id: "서비스업", label: "서비스업", color: "#df2f4a", order: 2 },
        { id: "일반음식점/배달전문", label: "일반음식점/배달전문", color: "#007eb5", order: 3 },
        { id: "건설업", label: "건설업", color: "#9d50dd", order: 4 },
        { id: "정보통신업", label: "정보통신업", color: "#037f4c", order: 5 },
        { id: "프랜차이즈업", label: "프랜차이즈업", color: "#579bfc", order: 6 },
        { id: "운수업", label: "운수업", color: "#cab641", order: 7 },
      ],
    },
    // 먼데이 dropdown 은 다중 선택이 가능하므로 multiselect 로 옮긴다.
    { key: "dropdown_mkyfg5he", label: "사업자유형", type: "multiselect", optionRef: "biz_reg_type", width: 120 },
    { key: "date_mkyfx3dp", label: "창업년도", type: "date", width: 110 },
    { key: "dropdown_mkyfat98", label: "지역", type: "multiselect", optionRef: "region", width: 140 },
    { key: "___9", label: "대표자명", type: "text", width: 100 },
    { key: "___3", label: "매출액", type: "text", width: 110 },
    {
      key: "color",
      label: "계약상황",
      type: "select",
      width: 140,
      options: [
        { id: "계약 전", label: "계약 전", color: GREY, order: 0 },
        { id: "계약서 요청", label: "계약서 요청", color: "#fdab3d", order: 1 },
        { id: "계약서 작성완료", label: "계약서 작성완료", color: "#00c875", order: 2 },
        { id: "계약 보류", label: "계약 보류", color: "#df2f4a", order: 3 },
        { id: "계약고민", label: "계약고민", color: "#579bfc", order: 4 },
        { id: "연결안됨", label: "연결안됨", color: "#cab641", order: 5 },
        { id: "다시전화", label: "다시전화", color: "#ffcb00", order: 6 },
        { id: "진행했다함", label: "진행했다함", color: "#333333", order: 7 },
        { id: "미팅보류", label: "미팅보류", color: "#9d50dd", order: 8 },
        { id: "미팅취소", label: "미팅취소", color: "#cd9282", order: 9 },
        { id: "계약취소", label: "계약취소", color: "#bb3354", order: 10 },
      ],
    },
    // 시드 확정 ③: 선택지형 담당자(`color_mkx7de80` 담당자 구분 — 담당자 미정 + 직원 실명
    // 2명)는 심지 않는다. 이 보드의 담당자는 위 `person` 멤버 컬럼 하나다.
    {
      key: "color_mm4td02",
      label: "이동",
      type: "select",
      width: 110,
      options: [
        { id: "이동 클릭", label: "이동 클릭", color: "#00c875", order: 0 },
        { id: "이동 전", label: "이동 전", color: GREY, order: 1 },
      ],
    },
    { key: "long_text", label: "상담내용", type: "longtext", width: null },
    { key: "date4", label: "전자계약 / 미팅일정", type: "datetime", width: 160 },
    {
      key: "color8",
      label: "미팅확정 메세지",
      type: "select",
      width: 140,
      options: [
        { id: "보내기기", label: "보내기기", color: "#00c875", order: 0 },
        { id: "미팅 미지정", label: "미팅 미지정", color: GREY, order: 1 },
      ],
    },
    { key: "boolean", label: "미팅", type: "checkbox", width: 80 },
    { key: "___6", label: "계약금", type: "number", width: 110 },
    {
      key: "___",
      label: "계약금 완료여부",
      type: "select",
      width: 130,
      options: [
        { id: "계약금 완", label: "계약금 완", color: "#fdab3d", order: 0 },
        { id: "계약금 미", label: "계약금 미", color: GREY, order: 1 },
      ],
    },
    {
      // "업무관리 이동" 이 업무관리 보드로 넘기는 트리거다(WO-5). 구조만 심는다.
      key: "status",
      label: "업무이동",
      type: "select",
      width: 130,
      options: [
        { id: "업무관리 이동", label: "업무관리 이동", color: "#00c875", order: 0 },
        { id: "뒤로가기", label: "뒤로가기", color: "#9d50dd", order: 1 },
        { id: "계약보류", label: "계약보류", color: "#fdab3d", order: 2 },
        { id: "미팅보류", label: "미팅보류", color: "#007eb5", order: 3 },
        { id: "미팅취소", label: "미팅취소", color: "#ff007f", order: 4 },
        { id: "계약취소", label: "계약취소", color: "#333333", order: 5 },
        { id: "업무 진행 전", label: "업무 진행 전", color: GREY, order: 6 },
      ],
    },
    { key: "email_mm406jm2", label: "이메일", type: "email", width: 160 },
  ],

  deferredColumns: [{ key: "______", label: "하위 아이템", kind: "subtasks" }],

  sections: [
    { name: "컨텍관리-컨텍", groupName: "💰컨텍", color: "#a25ddc", order: 0 },
    // 담당자별 그룹(D73) — 실명 대신 슬롯. 원본은 직원 실명 2명이 각 그룹명에 박혀 있었다.
    { name: "컨텍관리-담당자별-1", groupName: "💰", color: "#007eb5", order: 1, assigneeSlot: 0 },
    { name: "컨텍관리-담당자별-2", groupName: "💰", color: "#037f4c", order: 2, assigneeSlot: 1 },
    { name: "컨텍관리-계약보류", groupName: "💰계약보류(온/오프)", color: "#FFCB00", order: 3 },
    { name: "컨텍관리-미팅보류", groupName: "📍미팅보류", color: "#0086c0", order: 4 },
    { name: "컨텍관리-미팅취소", groupName: "📍미팅취소", color: "#FF158A", order: 5 },
    { name: "컨텍관리-계약취소", groupName: "📍계약취소", color: "#9CD326", order: 6 },
  ],

  views: [{ name: "전체", kind: "table", shared: true }],
};
