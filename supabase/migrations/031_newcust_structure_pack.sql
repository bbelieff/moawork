-- =====================================================================
-- 031_newcust_structure_pack.sql — 서울경영 3보드 구조 팩 (PLAN-002/WO-1)
--
-- 성격 : 003 boards 엔진 위에 additive. 기존 마이그레이션 무수정.
--        전역 카탈로그 1개 추가 + 팩 1행 시드. 조직 데이터는 만들지 않는다.
-- 원칙 : 먼데이 워크스페이스는 **구조만 복제**한다(PLAN-002 §1).
--        실데이터 8,413건 이관은 목표가 아니다.
-- 출처 : monday 서울경영지원센터(520253) 실측 2026-08-05
--        boards 1816794539(신규고객) / 1816794566(컨텍관리) / 1814266449(업무관리)
-- 용어 : **아이템 = 탭 안의 그룹**(PLAN-002 §1, 사용자 확정 2026-08-04).
--        먼데이 API 의 item(행)과 다르다. 팩은 보드 통짜가 아니라 그룹 단위
--        아이템 프리셋 32종(신규업체 14 + 컨텍관리 7 + 업무관리 11)으로 분해돼 있고,
--        이것이 WO-6 공용 프리셋 라이브러리의 초기 데이터가 된다.
-- 경계 : 수식·타임라인·하위아이템은 001 field_type enum(13종)에 대응이 없어
--        `deferredColumns` 로 **구조만 기록**한다. 계산 엔진과 실동작은 PLAN-003.
--        저장 뷰는 이름·구조만 심고 다중값 필터 적용은 WO-3 소유다.
-- 앱측 : `app/src/lib/structure-packs/*` 가 같은 데이터를 갖는다.
--        두 정의가 어긋나면 `seoul-pack.test.ts` 가 실패한다.
-- 선행 : 001 → 002 → 003 → … → 030
-- =====================================================================

create table if not exists structure_packs (   -- 전역 카탈로그(보드 구조 팩)
  key        text primary key,                 -- pack.seoul.policyfund1 ...
  name       text not null,
  pack_jsonb jsonb not null default '{}'
);

-- 전역 카탈로그라 조직 경계가 없다(industry_modules 와 같은 성격).
-- 읽기는 로그인 사용자 전체에 열고 쓰기는 열지 않는다.
alter table structure_packs enable row level security;
create policy structure_packs_read on structure_packs for select to authenticated using (true);

insert into structure_packs(key, name, pack_jsonb)
values (
  'pack.seoul.policyfund1',
  '모아프리셋-정책자금1',
  $json$
{
  "key": "pack.seoul.policyfund1",
  "name": "모아프리셋-정책자금1",
  "source": "monday 서울경영지원센터(520253) 실측 2026-08-05 · boards 1816794539 / 1816794566 / 1814266449",
  "boards": [
    {
      "slug": "newcust",
      "name": "🔥신규고객",
      "icon": "🔥",
      "description": "신규 상담 원장 — 유입부터 컨텍관리 이동까지",
      "mondayBoardId": "1816794539",
      "columns": [
        {
          "key": "___1",
          "label": "신청일",
          "type": "date",
          "width": 120
        },
        {
          "key": "text_mm40jz80",
          "label": "광고 명",
          "type": "text",
          "width": 120
        },
        {
          "key": "text_mkz0gcyr",
          "label": "사업자 유형",
          "type": "text",
          "width": 110
        },
        {
          "key": "text_mm2czkqg",
          "label": "회사명",
          "type": "text",
          "width": 160
        },
        {
          "key": "___88",
          "label": "매출액",
          "type": "text",
          "width": 110
        },
        {
          "key": "text8",
          "label": "연락처",
          "type": "text",
          "width": 130
        },
        {
          "key": "file",
          "label": "파일",
          "type": "file",
          "width": 90
        },
        {
          "key": "dup__of____",
          "label": "대표자명",
          "type": "text",
          "width": 100
        },
        {
          "key": "___8",
          "label": "주소",
          "type": "text",
          "width": 180
        },
        {
          "key": "email_mm40x2jr",
          "label": "이메일",
          "type": "email",
          "width": 160
        },
        {
          "key": "___14",
          "label": "출동",
          "type": "person",
          "width": 110
        },
        {
          "key": "color_mm3acc4d",
          "label": "📬부재 메세지",
          "type": "select",
          "width": 130,
          "options": [
            {
              "id": "1번 부재",
              "label": "1번 부재",
              "color": "#fdab3d",
              "order": 0
            },
            {
              "id": "2번 부재",
              "label": "2번 부재",
              "color": "#007eb5",
              "order": 1
            },
            {
              "id": "3번 부재",
              "label": "3번 부재",
              "color": "#df2f4a",
              "order": 2
            },
            {
              "id": "4번 부재",
              "label": "4번 부재",
              "color": "#00c875",
              "order": 3
            },
            {
              "id": "1일 1회 전화",
              "label": "1일 1회 전화",
              "color": "#c4c4c4",
              "order": 4
            }
          ]
        },
        {
          "key": "color3",
          "label": "📬악성부재 메세지전달",
          "type": "select",
          "width": 150,
          "options": [
            {
              "id": "보내기 전",
              "label": "보내기 전",
              "color": "#c4c4c4",
              "order": 0
            },
            {
              "id": "부재 메세지 전달",
              "label": "부재 메세지 전달",
              "color": "#00c875",
              "order": 1
            }
          ]
        },
        {
          "key": "color_mkyeay16",
          "label": "담당자",
          "type": "select",
          "width": 120,
          "options": [
            {
              "id": "이대표",
              "label": "이대표",
              "color": "#225091",
              "order": 0
            },
            {
              "id": "박정화 실장",
              "label": "박정화 실장",
              "color": "#757575",
              "order": 1
            },
            {
              "id": "담당자 미정",
              "label": "담당자 미정",
              "color": "#c4c4c4",
              "order": 2
            }
          ]
        },
        {
          "key": "long_text",
          "label": "상담내용",
          "type": "longtext",
          "width": null
        },
        {
          "key": "color",
          "label": "📬AI_1차",
          "type": "select",
          "width": 120,
          "options": [
            {
              "id": "1차 상담완료",
              "label": "1차 상담완료",
              "color": "#00c875",
              "order": 0
            },
            {
              "id": "보내기 전",
              "label": "보내기 전",
              "color": "#c4c4c4",
              "order": 1
            }
          ]
        },
        {
          "key": "status",
          "label": "상담 상황",
          "type": "select",
          "width": 140,
          "options": [
            {
              "id": "2차 상담예약",
              "label": "2차 상담예약",
              "color": "#9d50dd",
              "order": 0
            },
            {
              "id": "해당안됨",
              "label": "해당안됨",
              "color": "#9aadbd",
              "order": 1
            },
            {
              "id": "1차 부재",
              "label": "1차 부재",
              "color": "#007eb5",
              "order": 2
            },
            {
              "id": "거절",
              "label": "거절",
              "color": "#df2f4a",
              "order": 3
            },
            {
              "id": "2차 부재",
              "label": "2차 부재",
              "color": "#225091",
              "order": 4
            },
            {
              "id": "2차 상담완료",
              "label": "2차 상담완료",
              "color": "#66ccff",
              "order": 5
            },
            {
              "id": "2차 후 고민",
              "label": "2차 후 고민",
              "color": "#579bfc",
              "order": 6
            },
            {
              "id": "계약서 요청",
              "label": "계약서 요청",
              "color": "#00c875",
              "order": 7
            },
            {
              "id": "고민",
              "label": "고민",
              "color": "#bb3354",
              "order": 8
            },
            {
              "id": "보류",
              "label": "보류",
              "color": "#fdab3d",
              "order": 9
            },
            {
              "id": "관리",
              "label": "관리",
              "color": "#cab641",
              "order": 10
            },
            {
              "id": "지원사업만 알아봄",
              "label": "지원사업만 알아봄",
              "color": "#ff5ac4",
              "order": 11
            },
            {
              "id": "제조업 1차부재",
              "label": "제조업 1차부재",
              "color": "#7f5347",
              "order": 12
            },
            {
              "id": "제조업 2차부재",
              "label": "제조업 2차부재",
              "color": "#563e3e",
              "order": 13
            },
            {
              "id": "다시 상담",
              "label": "다시 상담",
              "color": "#333333",
              "order": 14
            },
            {
              "id": "상담 전",
              "label": "상담 전",
              "color": "#c4c4c4",
              "order": 15
            }
          ]
        },
        {
          "key": "dup__of_ai___",
          "label": "📬AI_2차 확정",
          "type": "select",
          "width": 130,
          "options": [
            {
              "id": "심사확정",
              "label": "심사확정",
              "color": "#00c875",
              "order": 0
            },
            {
              "id": "심사 전",
              "label": "심사 전",
              "color": "#c4c4c4",
              "order": 1
            }
          ]
        },
        {
          "key": "color_mkyf3jj6",
          "label": "피드백 상황",
          "type": "select",
          "width": 120,
          "options": [
            {
              "id": "피드백 전",
              "label": "피드백 전",
              "color": "#c4c4c4",
              "order": 0
            },
            {
              "id": "피드백 완료",
              "label": "피드백 완료",
              "color": "#00c875",
              "order": 1
            },
            {
              "id": "정보보완",
              "label": "정보보완",
              "color": "#fdab3d",
              "order": 2
            },
            {
              "id": "서류보완",
              "label": "서류보완",
              "color": "#df2f4a",
              "order": 3
            }
          ]
        },
        {
          "key": "dup__of_ai_2___",
          "label": "📬AI_3차불가",
          "type": "select",
          "width": 120,
          "options": [
            {
              "id": "여부 미정",
              "label": "여부 미정",
              "color": "#c4c4c4",
              "order": 0
            },
            {
              "id": "심사거절",
              "label": "심사거절",
              "color": "#df2f4a",
              "order": 1
            }
          ]
        },
        {
          "key": "__1",
          "label": "컨텍관리",
          "type": "select",
          "width": 120,
          "options": [
            {
              "id": "컨텍이동",
              "label": "컨텍이동",
              "color": "#00c875",
              "order": 0
            },
            {
              "id": "컨텍 대기",
              "label": "컨텍 대기",
              "color": "#c4c4c4",
              "order": 1
            }
          ]
        },
        {
          "key": "color_mkyf3bdg",
          "label": "컨텍여부",
          "type": "select",
          "width": 130,
          "options": [
            {
              "id": "생각 중",
              "label": "생각 중",
              "color": "#fdab3d",
              "order": 0
            },
            {
              "id": "컨텍관리 이동",
              "label": "컨텍관리 이동",
              "color": "#00c875",
              "order": 1
            },
            {
              "id": "거절",
              "label": "거절",
              "color": "#df2f4a",
              "order": 2
            },
            {
              "id": "컨텍 이동대기",
              "label": "컨텍 이동대기",
              "color": "#c4c4c4",
              "order": 3
            }
          ]
        },
        {
          "key": "date",
          "label": "재 유선상담",
          "type": "datetime",
          "width": 150
        },
        {
          "key": "date4",
          "label": "대면미팅",
          "type": "datetime",
          "width": 150
        },
        {
          "key": "numeric",
          "label": "계약금",
          "type": "number",
          "width": 110
        }
      ],
      "deferredColumns": [
        {
          "key": "______",
          "label": "하위 아이템",
          "kind": "subtasks",
          "source": "monday subtasks board 1816856300"
        },
        {
          "key": "_____",
          "label": "생성 로그",
          "kind": "creation_log"
        }
      ],
      "sections": [
        {
          "name": "신규업체-신규고객",
          "groupName": "💡신규고객",
          "color": "#FFCB00",
          "order": 0
        },
        {
          "name": "신규업체-1차 부재",
          "groupName": "🔇1차 부재",
          "color": "#0086c0",
          "order": 1
        },
        {
          "name": "신규업체-2차 상담고객",
          "groupName": "🔍2차 상담고객",
          "color": "#9CD326",
          "order": 2
        },
        {
          "name": "신규업체-박정화 실장",
          "groupName": "♻️박정화 실장",
          "color": "#757575",
          "order": 3
        },
        {
          "name": "신규업체-이대표",
          "groupName": "♻️이대표",
          "color": "#007eb5",
          "order": 4
        },
        {
          "name": "신규업체-제조업 1차 부재",
          "groupName": "제조업 1차 부재",
          "color": "#7f5347",
          "order": 5
        },
        {
          "name": "신규업체-제조업 2차 부재",
          "groupName": "제조업 2차 부재",
          "color": "#7f5347",
          "order": 6
        },
        {
          "name": "신규업체-2차 부재",
          "groupName": "🔇2차 부재",
          "color": "#579bfc",
          "order": 7
        },
        {
          "name": "신규업체-2차 후 고민",
          "groupName": "⏳️2차 후 고민",
          "color": "#9CD326",
          "order": 8
        },
        {
          "name": "신규업체-관리",
          "groupName": "⚒️관리(업력 신용 등)",
          "color": "#FFCB00",
          "order": 9
        },
        {
          "name": "신규업체-보류",
          "groupName": "📑보류",
          "color": "#FF642E",
          "order": 10
        },
        {
          "name": "신규업체-해당안되는 업체",
          "groupName": "⛔️해당안되는 업체",
          "color": "#c4c4c4",
          "order": 11
        },
        {
          "name": "신규업체-거절",
          "groupName": "🚫거절",
          "color": "#FF158A",
          "order": 12
        },
        {
          "name": "신규업체-지원사업만",
          "groupName": "🔅지원사업만",
          "color": "#9cd326",
          "order": 13
        }
      ],
      "views": [
        {
          "name": "전체",
          "kind": "table",
          "shared": true
        },
        {
          "name": "이대표",
          "kind": "table",
          "filters": {
            "color_mkyeay16": [
              "이대표"
            ]
          },
          "shared": true
        },
        {
          "name": "박정화 실장",
          "kind": "table",
          "filters": {
            "color_mkyeay16": [
              "박정화 실장"
            ]
          },
          "shared": true
        },
        {
          "name": "미배정",
          "kind": "table",
          "filters": {
            "color_mkyeay16": [
              "담당자 미정"
            ]
          },
          "shared": true
        }
      ]
    },
    {
      "slug": "contact",
      "name": "🔥컨텍관리",
      "icon": "🔥",
      "description": "계약 직전 단계 — 미팅·계약금·업무관리 인계",
      "mondayBoardId": "1816794566",
      "columns": [
        {
          "key": "text_mm40wa7d",
          "label": "광고 명",
          "type": "text",
          "width": 120
        },
        {
          "key": "person",
          "label": "담당자",
          "type": "person",
          "width": 110
        },
        {
          "key": "___13",
          "label": "신청일",
          "type": "date",
          "width": 120
        },
        {
          "key": "___67",
          "label": "회사명",
          "type": "text",
          "width": 160
        },
        {
          "key": "file",
          "label": "파일",
          "type": "file",
          "width": 90
        },
        {
          "key": "____",
          "label": "연락처",
          "type": "phone",
          "width": 130
        },
        {
          "key": "color_mkyf7hr3",
          "label": "업종/업태",
          "type": "select",
          "width": 140,
          "options": [
            {
              "id": "제조업",
              "label": "제조업",
              "color": "#fdab3d",
              "order": 0
            },
            {
              "id": "도소매업",
              "label": "도소매업",
              "color": "#00c875",
              "order": 1
            },
            {
              "id": "서비스업",
              "label": "서비스업",
              "color": "#df2f4a",
              "order": 2
            },
            {
              "id": "일반음식점/배달전문",
              "label": "일반음식점/배달전문",
              "color": "#007eb5",
              "order": 3
            },
            {
              "id": "건설업",
              "label": "건설업",
              "color": "#9d50dd",
              "order": 4
            },
            {
              "id": "정보통신업",
              "label": "정보통신업",
              "color": "#037f4c",
              "order": 5
            },
            {
              "id": "프랜차이즈업",
              "label": "프랜차이즈업",
              "color": "#579bfc",
              "order": 6
            },
            {
              "id": "운수업",
              "label": "운수업",
              "color": "#cab641",
              "order": 7
            }
          ]
        },
        {
          "key": "dropdown_mkyfg5he",
          "label": "사업자유형",
          "type": "multiselect",
          "optionRef": "biz_reg_type",
          "width": 120
        },
        {
          "key": "date_mkyfx3dp",
          "label": "창업년도",
          "type": "date",
          "width": 110
        },
        {
          "key": "dropdown_mkyfat98",
          "label": "지역",
          "type": "multiselect",
          "optionRef": "region",
          "width": 140
        },
        {
          "key": "___9",
          "label": "대표자명",
          "type": "text",
          "width": 100
        },
        {
          "key": "___3",
          "label": "매출액",
          "type": "text",
          "width": 110
        },
        {
          "key": "color",
          "label": "계약상황",
          "type": "select",
          "width": 140,
          "options": [
            {
              "id": "계약 전",
              "label": "계약 전",
              "color": "#c4c4c4",
              "order": 0
            },
            {
              "id": "계약서 요청",
              "label": "계약서 요청",
              "color": "#fdab3d",
              "order": 1
            },
            {
              "id": "계약서 작성완료",
              "label": "계약서 작성완료",
              "color": "#00c875",
              "order": 2
            },
            {
              "id": "계약 보류",
              "label": "계약 보류",
              "color": "#df2f4a",
              "order": 3
            },
            {
              "id": "계약고민",
              "label": "계약고민",
              "color": "#579bfc",
              "order": 4
            },
            {
              "id": "연결안됨",
              "label": "연결안됨",
              "color": "#cab641",
              "order": 5
            },
            {
              "id": "다시전화",
              "label": "다시전화",
              "color": "#ffcb00",
              "order": 6
            },
            {
              "id": "진행했다함",
              "label": "진행했다함",
              "color": "#333333",
              "order": 7
            },
            {
              "id": "미팅보류",
              "label": "미팅보류",
              "color": "#9d50dd",
              "order": 8
            },
            {
              "id": "미팅취소",
              "label": "미팅취소",
              "color": "#cd9282",
              "order": 9
            },
            {
              "id": "계약취소",
              "label": "계약취소",
              "color": "#bb3354",
              "order": 10
            }
          ]
        },
        {
          "key": "color_mkx7de80",
          "label": "담당자 구분",
          "type": "select",
          "width": 120,
          "options": [
            {
              "id": "담당자 미정",
              "label": "담당자 미정",
              "color": "#c4c4c4",
              "order": 0
            },
            {
              "id": "박정화",
              "label": "박정화",
              "color": "#00c875",
              "order": 1
            },
            {
              "id": "이대표",
              "label": "이대표",
              "color": "#225091",
              "order": 2
            }
          ]
        },
        {
          "key": "color_mm4td02",
          "label": "이동",
          "type": "select",
          "width": 110,
          "options": [
            {
              "id": "이동 클릭",
              "label": "이동 클릭",
              "color": "#00c875",
              "order": 0
            },
            {
              "id": "이동 전",
              "label": "이동 전",
              "color": "#c4c4c4",
              "order": 1
            }
          ]
        },
        {
          "key": "long_text",
          "label": "상담내용",
          "type": "longtext",
          "width": null
        },
        {
          "key": "date4",
          "label": "전자계약 / 미팅일정",
          "type": "datetime",
          "width": 160
        },
        {
          "key": "color8",
          "label": "미팅확정 메세지",
          "type": "select",
          "width": 140,
          "options": [
            {
              "id": "보내기기",
              "label": "보내기기",
              "color": "#00c875",
              "order": 0
            },
            {
              "id": "미팅 미지정",
              "label": "미팅 미지정",
              "color": "#c4c4c4",
              "order": 1
            }
          ]
        },
        {
          "key": "boolean",
          "label": "미팅",
          "type": "checkbox",
          "width": 80
        },
        {
          "key": "___6",
          "label": "계약금",
          "type": "number",
          "width": 110
        },
        {
          "key": "___",
          "label": "계약금 완료여부",
          "type": "select",
          "width": 130,
          "options": [
            {
              "id": "계약금 완",
              "label": "계약금 완",
              "color": "#fdab3d",
              "order": 0
            },
            {
              "id": "계약금 미",
              "label": "계약금 미",
              "color": "#c4c4c4",
              "order": 1
            }
          ]
        },
        {
          "key": "status",
          "label": "업무이동",
          "type": "select",
          "width": 130,
          "options": [
            {
              "id": "업무관리 이동",
              "label": "업무관리 이동",
              "color": "#00c875",
              "order": 0
            },
            {
              "id": "뒤로가기",
              "label": "뒤로가기",
              "color": "#9d50dd",
              "order": 1
            },
            {
              "id": "계약보류",
              "label": "계약보류",
              "color": "#fdab3d",
              "order": 2
            },
            {
              "id": "미팅보류",
              "label": "미팅보류",
              "color": "#007eb5",
              "order": 3
            },
            {
              "id": "미팅취소",
              "label": "미팅취소",
              "color": "#ff007f",
              "order": 4
            },
            {
              "id": "계약취소",
              "label": "계약취소",
              "color": "#333333",
              "order": 5
            },
            {
              "id": "업무 진행 전",
              "label": "업무 진행 전",
              "color": "#c4c4c4",
              "order": 6
            }
          ]
        },
        {
          "key": "email_mm406jm2",
          "label": "이메일",
          "type": "email",
          "width": 160
        }
      ],
      "deferredColumns": [
        {
          "key": "______",
          "label": "하위 아이템",
          "kind": "subtasks"
        }
      ],
      "sections": [
        {
          "name": "컨텍관리-컨텍",
          "groupName": "💰컨텍",
          "color": "#a25ddc",
          "order": 0
        },
        {
          "name": "컨텍관리-이대표",
          "groupName": "💰이대표",
          "color": "#007eb5",
          "order": 1
        },
        {
          "name": "컨텍관리-박정화 실장",
          "groupName": "💰박정화 실장",
          "color": "#037f4c",
          "order": 2
        },
        {
          "name": "컨텍관리-계약보류",
          "groupName": "💰계약보류(온/오프)",
          "color": "#FFCB00",
          "order": 3
        },
        {
          "name": "컨텍관리-미팅보류",
          "groupName": "📍미팅보류",
          "color": "#0086c0",
          "order": 4
        },
        {
          "name": "컨텍관리-미팅취소",
          "groupName": "📍미팅취소",
          "color": "#FF158A",
          "order": 5
        },
        {
          "name": "컨텍관리-계약취소",
          "groupName": "📍계약취소",
          "color": "#9CD326",
          "order": 6
        }
      ],
      "views": [
        {
          "name": "전체",
          "kind": "table",
          "shared": true
        }
      ]
    },
    {
      "slug": "work",
      "name": "🔥업무관리",
      "icon": "🔥",
      "description": "실행 단계 — 기관·상품별 진행과 수수료 정산",
      "mondayBoardId": "1814266449",
      "columns": [
        {
          "key": "project_owner",
          "label": "담당자",
          "type": "person",
          "width": 110
        },
        {
          "key": "text",
          "label": "회사명",
          "type": "text",
          "width": 160
        },
        {
          "key": "link_mky5wdr",
          "label": "홈페이지",
          "type": "url",
          "width": 140
        },
        {
          "key": "dropdown_mky5vvck",
          "label": "사업자유형",
          "type": "multiselect",
          "optionRef": "biz_reg_type",
          "width": 120
        },
        {
          "key": "date_mky57cjt",
          "label": "창업년도",
          "type": "date",
          "width": 110
        },
        {
          "key": "file",
          "label": "파일",
          "type": "file",
          "width": 90
        },
        {
          "key": "link_mm5eqwt6",
          "label": "링크",
          "type": "url",
          "width": 120
        },
        {
          "key": "numeric_mky5jtvz",
          "label": "연 매출액",
          "type": "number",
          "width": 120
        },
        {
          "key": "text0",
          "label": "대표자명",
          "type": "text",
          "width": 100
        },
        {
          "key": "email_mm40ka2r",
          "label": "이메일",
          "type": "email",
          "width": 160
        },
        {
          "key": "phone",
          "label": "전화번호",
          "type": "phone",
          "width": 130
        },
        {
          "key": "color_mky856yd",
          "label": "업종/업태",
          "type": "select",
          "width": 140,
          "options": [
            {
              "id": "제조업",
              "label": "제조업",
              "color": "#fdab3d",
              "order": 0
            },
            {
              "id": "도소매업",
              "label": "도소매업",
              "color": "#00c875",
              "order": 1
            },
            {
              "id": "서비스업",
              "label": "서비스업",
              "color": "#df2f4a",
              "order": 2
            },
            {
              "id": "일반음식점/배달전문",
              "label": "일반음식점/배달전문",
              "color": "#007eb5",
              "order": 3
            },
            {
              "id": "건설업",
              "label": "건설업",
              "color": "#9d50dd",
              "order": 4
            },
            {
              "id": "프랜차이즈업",
              "label": "프랜차이즈업",
              "color": "#037f4c",
              "order": 5
            },
            {
              "id": "정보통신업",
              "label": "정보통신업",
              "color": "#579bfc",
              "order": 6
            },
            {
              "id": "운수업/유통업",
              "label": "운수업/유통업",
              "color": "#cab641",
              "order": 7
            },
            {
              "id": "어,농,축업",
              "label": "어,농,축업",
              "color": "#ffcb00",
              "order": 8
            },
            {
              "id": "미지정",
              "label": "미지정",
              "color": "#c4c4c4",
              "order": 9
            }
          ]
        },
        {
          "key": "dropdown_mky78058",
          "label": "지역",
          "type": "multiselect",
          "optionRef": "region",
          "width": 140
        },
        {
          "key": "color3",
          "label": "진행 기관",
          "type": "select",
          "width": 170,
          "options": [
            {
              "id": "직접_미소",
              "label": "직접_미소",
              "color": "#ff007f",
              "order": 0
            },
            {
              "id": "재단_인천,지방보증드림",
              "label": "재단_인천,지방보증드림",
              "color": "#401694",
              "order": 1
            },
            {
              "id": "재단_경기사이버보증",
              "label": "재단_경기사이버보증",
              "color": "#9cd326",
              "order": 2
            },
            {
              "id": "재단_서울보증",
              "label": "재단_서울보증",
              "color": "#7e3b8a",
              "order": 3
            },
            {
              "id": "간접_소공인_대리",
              "label": "간접_소공인_대리",
              "color": "#cab641",
              "order": 4
            },
            {
              "id": "소공인_대환",
              "label": "소공인_대환",
              "color": "#579bfc",
              "order": 5
            },
            {
              "id": "소상공인_직접대출",
              "label": "소상공인_직접대출",
              "color": "#ff5ac4",
              "order": 6
            },
            {
              "id": "직접_중진공",
              "label": "직접_중진공",
              "color": "#bb3354",
              "order": 7
            },
            {
              "id": "간접_기보",
              "label": "간접_기보",
              "color": "#00c875",
              "order": 8
            },
            {
              "id": "간접_신보",
              "label": "간접_신보",
              "color": "#037f4c",
              "order": 9
            },
            {
              "id": "간접_농신보",
              "label": "간접_농신보",
              "color": "#fdab3d",
              "order": 10
            },
            {
              "id": "간접_무보",
              "label": "간접_무보",
              "color": "#ffcb00",
              "order": 11
            },
            {
              "id": "소공인_희링턴",
              "label": "소공인_희링턴",
              "color": "#ffadad",
              "order": 12
            },
            {
              "id": "벤처인증",
              "label": "벤처인증",
              "color": "#7f5347",
              "order": 13
            },
            {
              "id": "K-스타트업",
              "label": "K-스타트업",
              "color": "#784bd1",
              "order": 14
            },
            {
              "id": "기업인증",
              "label": "기업인증",
              "color": "#333333",
              "order": 15
            },
            {
              "id": "바우처",
              "label": "바우처",
              "color": "#007eb5",
              "order": 16
            },
            {
              "id": "지원사업",
              "label": "지원사업",
              "color": "#563e3e",
              "order": 17
            }
          ]
        },
        {
          "key": "dropdown_mm313ck5",
          "label": "진행 상품",
          "type": "multiselect",
          "width": 180,
          "options": [
            {
              "id": "개발기술사업화",
              "label": "개발기술사업화",
              "order": 0
            },
            {
              "id": "제조현장스마트화",
              "label": "제조현장스마트화",
              "order": 1
            },
            {
              "id": "Net-Zero유망기업",
              "label": "Net-Zero유망기업",
              "order": 2
            },
            {
              "id": "스케일업 금융",
              "label": "스케일업 금융",
              "order": 3
            },
            {
              "id": "내수기업 수출기업화",
              "label": "내수기업 수출기업화",
              "order": 4
            },
            {
              "id": "수출기업글로벌화",
              "label": "수출기업글로벌화",
              "order": 5
            },
            {
              "id": "긴급경영안정",
              "label": "긴급경영안정",
              "order": 6
            },
            {
              "id": "사업전환",
              "label": "사업전환",
              "order": 7
            },
            {
              "id": "매출채권팩토링",
              "label": "매출채권팩토링",
              "order": 8
            },
            {
              "id": "동반성장네트워크론",
              "label": "동반성장네트워크론",
              "order": 9
            },
            {
              "id": "창업기반지원",
              "label": "창업기반지원",
              "order": 10
            },
            {
              "id": "혁신성장지원",
              "label": "혁신성장지원",
              "order": 11
            },
            {
              "id": "구조개선전용",
              "label": "구조개선전용",
              "order": 12
            },
            {
              "id": "소공인특화자금",
              "label": "소공인특화자금",
              "order": 13
            },
            {
              "id": "일반자금",
              "label": "일반자금",
              "order": 14
            },
            {
              "id": "긴급경영안정자금(재해피해)",
              "label": "긴급경영안정자금(재해피해)",
              "order": 15
            },
            {
              "id": "긴급경영안정자금(일시적 경영애로)",
              "label": "긴급경영안정자금(일시적 경영애로)",
              "order": 16
            },
            {
              "id": "장애인기업지원자금",
              "label": "장애인기업지원자금",
              "order": 17
            },
            {
              "id": "청년고용연계자금",
              "label": "청년고용연계자금",
              "order": 18
            },
            {
              "id": "대환대출",
              "label": "대환대출",
              "order": 19
            },
            {
              "id": "혁신성장_일반형",
              "label": "혁신성장_일반형",
              "order": 20
            },
            {
              "id": "혁신성장_혁신형",
              "label": "혁신성장_혁신형",
              "order": 21
            },
            {
              "id": "민간투자연계형매칭융자",
              "label": "민간투자연계형매칭융자",
              "order": 22
            },
            {
              "id": "신용취약소상공인자금",
              "label": "신용취약소상공인자금",
              "order": 23
            },
            {
              "id": "재도전특별자금(일반형)",
              "label": "재도전특별자금(일반형)",
              "order": 24
            },
            {
              "id": "재도전특별자금(희망형)",
              "label": "재도전특별자금(희망형)",
              "order": 25
            },
            {
              "id": "재도전특별자금(도약형)",
              "label": "재도전특별자금(도약형)",
              "order": 26
            },
            {
              "id": "상생성장지원자금",
              "label": "상생성장지원자금",
              "order": 27
            },
            {
              "id": "수출바우처",
              "label": "수출바우처",
              "order": 28
            },
            {
              "id": "제조바우처",
              "label": "제조바우처",
              "order": 29
            },
            {
              "id": "혁신바우처",
              "label": "혁신바우처",
              "order": 30
            },
            {
              "id": "예비창업패키지",
              "label": "예비창업패키지",
              "order": 31
            },
            {
              "id": "초기창업패키지",
              "label": "초기창업패키지",
              "order": 32
            },
            {
              "id": "청년창업패키지",
              "label": "청년창업패키지",
              "order": 33
            },
            {
              "id": "청년창업사관학교",
              "label": "청년창업사관학교",
              "order": 34
            },
            {
              "id": "희망리턴_재창업",
              "label": "희망리턴_재창업",
              "order": 35
            },
            {
              "id": "희망리턴_경영개선",
              "label": "희망리턴_경영개선",
              "order": 36
            },
            {
              "id": "일반운전자금",
              "label": "일반운전자금",
              "order": 37
            },
            {
              "id": "시설자금",
              "label": "시설자금",
              "order": 38
            },
            {
              "id": "재단 안심통장_1천",
              "label": "재단 안심통장_1천",
              "order": 39
            },
            {
              "id": "특례보증",
              "label": "특례보증",
              "order": 40
            },
            {
              "id": "지역금융 협약보증",
              "label": "지역금융 협약보증",
              "order": 41
            },
            {
              "id": "ISO 9001",
              "label": "ISO 9001",
              "order": 42
            },
            {
              "id": "ISO 14001",
              "label": "ISO 14001",
              "order": 43
            },
            {
              "id": "ISO 45001",
              "label": "ISO 45001",
              "order": 44
            },
            {
              "id": "연구소개발전담부서",
              "label": "연구소개발전담부서",
              "order": 45
            },
            {
              "id": "벤처기업인증(혁신)",
              "label": "벤처기업인증(혁신)",
              "order": 46
            },
            {
              "id": "이노비즈인증",
              "label": "이노비즈인증",
              "order": 47
            },
            {
              "id": "메인비즈인증",
              "label": "메인비즈인증",
              "order": 48
            },
            {
              "id": "벤처기업인증(연구)",
              "label": "벤처기업인증(연구)",
              "order": 49
            },
            {
              "id": "벤처기업인증(투자)",
              "label": "벤처기업인증(투자)",
              "order": 50
            },
            {
              "id": "혁신성장_혁신형_수출",
              "label": "혁신성장_혁신형_수출",
              "order": 51
            },
            {
              "id": "혁신성장_혁신형_매출",
              "label": "혁신성장_혁신형_매출",
              "order": 52
            },
            {
              "id": "혁신성장_혁신형_스마트공장",
              "label": "혁신성장_혁신형_스마트공장",
              "order": 53
            },
            {
              "id": "혁신성장_졸업후보",
              "label": "혁신성장_졸업후보",
              "order": 54
            },
            {
              "id": "취약계층 희망드림 특례보증",
              "label": "취약계층 희망드림 특례보증",
              "order": 55
            },
            {
              "id": "신한금융 협약보증",
              "label": "신한금융 협약보증",
              "order": 56
            },
            {
              "id": "지역 특례보증(경북버팀금융)",
              "label": "지역 특례보증(경북버팀금융)",
              "order": 57
            },
            {
              "id": "일시적경영애로",
              "label": "일시적경영애로",
              "order": 58
            }
          ]
        },
        {
          "key": "color",
          "label": "진행상항",
          "type": "select",
          "width": 180,
          "options": [
            {
              "id": "대기중",
              "label": "대기중",
              "color": "#c4c4c4",
              "order": 0
            },
            {
              "id": "진행중",
              "label": "진행중",
              "color": "#fdab3d",
              "order": 1
            },
            {
              "id": "심사 중",
              "label": "심사 중",
              "color": "#ffcb00",
              "order": 2
            },
            {
              "id": "승인",
              "label": "승인",
              "color": "#00c875",
              "order": 3
            },
            {
              "id": "불가",
              "label": "불가",
              "color": "#ff007f",
              "order": 4
            },
            {
              "id": "관리중",
              "label": "관리중",
              "color": "#007eb5",
              "order": 5
            },
            {
              "id": "소공인(상생)",
              "label": "소공인(상생)",
              "color": "#bb3354",
              "order": 6
            },
            {
              "id": "기업인증 진행",
              "label": "기업인증 진행",
              "color": "#579bfc",
              "order": 7
            },
            {
              "id": "📂소진공 혁신성장 대기",
              "label": "📂소진공 혁신성장 대기",
              "color": "#df2f4a",
              "order": 8
            },
            {
              "id": "📂소진공 신용취약 대기",
              "label": "📂소진공 신용취약 대기",
              "color": "#037f4c",
              "order": 9
            },
            {
              "id": "📂소진공 일시적경영애로 대기",
              "label": "📂소진공 일시적경영애로 대기",
              "color": "#333333",
              "order": 10
            },
            {
              "id": "📂소진공 재도전 대기",
              "label": "📂소진공 재도전 대기",
              "color": "#ff5ac4",
              "order": 11
            },
            {
              "id": "해당연도 매출",
              "label": "해당연도 매출",
              "color": "#9d50dd",
              "order": 12
            },
            {
              "id": "업체관리",
              "label": "업체관리",
              "color": "#cab641",
              "order": 13
            }
          ]
        },
        {
          "key": "date_mkqp8y41",
          "label": "방문 및 신청 일",
          "type": "date",
          "width": 130
        },
        {
          "key": "date0",
          "label": "실사일",
          "type": "date",
          "width": 110
        },
        {
          "key": "____7",
          "label": "지도내용",
          "type": "longtext",
          "width": null
        },
        {
          "key": "numbers",
          "label": "실행액",
          "type": "number",
          "width": 120
        },
        {
          "key": "dup__of____",
          "label": "수수료(%)",
          "type": "number",
          "width": 100
        },
        {
          "key": "date3",
          "label": "수수료_입금일",
          "type": "date",
          "width": 130
        },
        {
          "key": "date8",
          "label": "재신청 안내일",
          "type": "date",
          "width": 130
        },
        {
          "key": "dup__of____3",
          "label": "계약금",
          "type": "number",
          "width": 110
        },
        {
          "key": "date5",
          "label": "계약금_입금일",
          "type": "date",
          "width": 130
        }
      ],
      "deferredColumns": [
        {
          "key": "subitems",
          "label": "하위 태스크",
          "kind": "subtasks"
        },
        {
          "key": "timerange8",
          "label": "예상 심사기간",
          "kind": "timeline"
        },
        {
          "key": "__41",
          "label": "수수료(원)",
          "kind": "formula",
          "source": "실행액 × 수수료(%) ÷ 100"
        },
        {
          "key": "__1",
          "label": "총 매출액",
          "kind": "formula",
          "source": "먼데이 원본 수식 — PLAN-003에서 재확인 필요"
        },
        {
          "key": "formula",
          "label": "D+180",
          "kind": "formula",
          "source": "수수료_입금일 + 180일"
        },
        {
          "key": "formula0",
          "label": "D+365",
          "kind": "formula",
          "source": "수수료_입금일 + 365일"
        }
      ],
      "sections": [
        {
          "name": "업무관리-준비단계",
          "groupName": "⏹️준비단계",
          "color": "#00c875",
          "order": 0
        },
        {
          "name": "업무관리-진행중",
          "groupName": "▶️진행중",
          "color": "#BB3354",
          "order": 1
        },
        {
          "name": "업무관리-심사 중",
          "groupName": "🔂심사 중",
          "color": "#9cd326",
          "order": 2
        },
        {
          "name": "업무관리-승인",
          "groupName": "💰승인",
          "color": "#cab641",
          "order": 3
        },
        {
          "name": "업무관리-소진공 취약자금 접수예정",
          "groupName": "📂소진공 취약자금 접수예정",
          "color": "#ffcb00",
          "order": 4
        },
        {
          "name": "업무관리-소진공 혁신성장 접수예정",
          "groupName": "📂소진공 혁신성장 접수예정",
          "color": "#ffcb00",
          "order": 5
        },
        {
          "name": "업무관리-소진공 일시적경영애로 접수예정",
          "groupName": "📂소진공 일시적경영애로 접수예정",
          "color": "#ffcb00",
          "order": 6
        },
        {
          "name": "업무관리-소진공 재도전 접수예정",
          "groupName": "📂소진공 재도전 접수예정",
          "color": "#ffcb00",
          "order": 7
        },
        {
          "name": "업무관리-기업인증 진행",
          "groupName": "기업인증 진행",
          "color": "#757575",
          "order": 8
        },
        {
          "name": "업무관리-관리중",
          "groupName": "관리중",
          "color": "#FF5AC4",
          "order": 9
        },
        {
          "name": "업무관리-대출불가",
          "groupName": "대출불가",
          "color": "#66CCFF",
          "order": 10
        }
      ],
      "views": [
        {
          "name": "재단_간접",
          "kind": "table",
          "shared": true
        },
        {
          "name": "간접_소공인",
          "kind": "table",
          "shared": true
        },
        {
          "name": "소공인 직접_취약",
          "kind": "table",
          "shared": true
        },
        {
          "name": "소공인 직접_혁신성장",
          "kind": "table",
          "shared": true
        },
        {
          "name": "소공인 직접_재도전",
          "kind": "table",
          "shared": true
        },
        {
          "name": "소공인 직접_일시적",
          "kind": "table",
          "shared": true
        },
        {
          "name": "중진공",
          "kind": "table",
          "shared": true
        }
      ]
    }
  ]
}  $json$::jsonb
)
on conflict (key) do update
  set name = excluded.name,
      pack_jsonb = excluded.pack_jsonb;
