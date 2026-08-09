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
-- 교정 : 시드 확정 3건(2026-08-05 MW-총괄 · PLAN-002 §5 WO-1)은 동일 복제에 우선한다.
--        ① Name = 업체명. 중복 `회사명` 컬럼 미수록(신규고객 28→27).
--        ② 지역은 공용 1세트 222지로 정규화(`시도_시군구`) — 팩 `optionSets.region`.
--           R1 218지·R2 문서 수록 234지를 전수 대응시킨 결과다.
--           먼데이 실측 카운트 239 중 5지는 저장소 안에 라벨 자료가 없어 미수록.
--        ③ 담당자 = 멤버(사람) 컬럼 단일화. 선택지형 담당자(직원 실명) 미수록.
--           전역 카탈로그라 특정 고객사 직원 실명을 심지 않는다.
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
  "source": "monday 서울경영지원센터(520253) 실측 2026-08-05 · boards 1816794539 / 1816794566 / 1814266449 · 시드 확정 3건 반영 2026-08-09",
  "optionSets": {
    "region": [
      {
        "id": "서울_강남구",
        "label": "서울_강남구",
        "order": 0
      },
      {
        "id": "서울_강동구",
        "label": "서울_강동구",
        "order": 1
      },
      {
        "id": "서울_강북구",
        "label": "서울_강북구",
        "order": 2
      },
      {
        "id": "서울_강서구",
        "label": "서울_강서구",
        "order": 3
      },
      {
        "id": "서울_관악구",
        "label": "서울_관악구",
        "order": 4
      },
      {
        "id": "서울_광진구",
        "label": "서울_광진구",
        "order": 5
      },
      {
        "id": "서울_구로구",
        "label": "서울_구로구",
        "order": 6
      },
      {
        "id": "서울_금천구",
        "label": "서울_금천구",
        "order": 7
      },
      {
        "id": "서울_노원구",
        "label": "서울_노원구",
        "order": 8
      },
      {
        "id": "서울_도봉구",
        "label": "서울_도봉구",
        "order": 9
      },
      {
        "id": "서울_동대문구",
        "label": "서울_동대문구",
        "order": 10
      },
      {
        "id": "서울_동작구",
        "label": "서울_동작구",
        "order": 11
      },
      {
        "id": "서울_마포구",
        "label": "서울_마포구",
        "order": 12
      },
      {
        "id": "서울_서대문구",
        "label": "서울_서대문구",
        "order": 13
      },
      {
        "id": "서울_서초구",
        "label": "서울_서초구",
        "order": 14
      },
      {
        "id": "서울_성동구",
        "label": "서울_성동구",
        "order": 15
      },
      {
        "id": "서울_성북구",
        "label": "서울_성북구",
        "order": 16
      },
      {
        "id": "서울_송파구",
        "label": "서울_송파구",
        "order": 17
      },
      {
        "id": "서울_양천구",
        "label": "서울_양천구",
        "order": 18
      },
      {
        "id": "서울_영등포구",
        "label": "서울_영등포구",
        "order": 19
      },
      {
        "id": "서울_용산구",
        "label": "서울_용산구",
        "order": 20
      },
      {
        "id": "서울_은평구",
        "label": "서울_은평구",
        "order": 21
      },
      {
        "id": "서울_종로구",
        "label": "서울_종로구",
        "order": 22
      },
      {
        "id": "서울_중구",
        "label": "서울_중구",
        "order": 23
      },
      {
        "id": "서울_중랑구",
        "label": "서울_중랑구",
        "order": 24
      },
      {
        "id": "부산_강서구",
        "label": "부산_강서구",
        "order": 25
      },
      {
        "id": "부산_금정구",
        "label": "부산_금정구",
        "order": 26
      },
      {
        "id": "부산_기장군",
        "label": "부산_기장군",
        "order": 27
      },
      {
        "id": "부산_남구",
        "label": "부산_남구",
        "order": 28
      },
      {
        "id": "부산_동구",
        "label": "부산_동구",
        "order": 29
      },
      {
        "id": "부산_동래구",
        "label": "부산_동래구",
        "order": 30
      },
      {
        "id": "부산_북구",
        "label": "부산_북구",
        "order": 31
      },
      {
        "id": "부산_사상구",
        "label": "부산_사상구",
        "order": 32
      },
      {
        "id": "부산_사하구",
        "label": "부산_사하구",
        "order": 33
      },
      {
        "id": "부산_서구",
        "label": "부산_서구",
        "order": 34
      },
      {
        "id": "부산_수영구",
        "label": "부산_수영구",
        "order": 35
      },
      {
        "id": "부산_연제구",
        "label": "부산_연제구",
        "order": 36
      },
      {
        "id": "부산_영도구",
        "label": "부산_영도구",
        "order": 37
      },
      {
        "id": "부산_중구",
        "label": "부산_중구",
        "order": 38
      },
      {
        "id": "부산_진구",
        "label": "부산_진구",
        "order": 39
      },
      {
        "id": "부산_해운대구",
        "label": "부산_해운대구",
        "order": 40
      },
      {
        "id": "대구_남구",
        "label": "대구_남구",
        "order": 41
      },
      {
        "id": "대구_달서구",
        "label": "대구_달서구",
        "order": 42
      },
      {
        "id": "대구_달성군",
        "label": "대구_달성군",
        "order": 43
      },
      {
        "id": "대구_동구",
        "label": "대구_동구",
        "order": 44
      },
      {
        "id": "대구_북구",
        "label": "대구_북구",
        "order": 45
      },
      {
        "id": "대구_서구",
        "label": "대구_서구",
        "order": 46
      },
      {
        "id": "대구_수성구",
        "label": "대구_수성구",
        "order": 47
      },
      {
        "id": "대구_중구",
        "label": "대구_중구",
        "order": 48
      },
      {
        "id": "인천_강화군",
        "label": "인천_강화군",
        "order": 49
      },
      {
        "id": "인천_계양구",
        "label": "인천_계양구",
        "order": 50
      },
      {
        "id": "인천_남동구",
        "label": "인천_남동구",
        "order": 51
      },
      {
        "id": "인천_동구",
        "label": "인천_동구",
        "order": 52
      },
      {
        "id": "인천_미추홀구",
        "label": "인천_미추홀구",
        "order": 53
      },
      {
        "id": "인천_부평구",
        "label": "인천_부평구",
        "order": 54
      },
      {
        "id": "인천_서구",
        "label": "인천_서구",
        "order": 55
      },
      {
        "id": "인천_연수구",
        "label": "인천_연수구",
        "order": 56
      },
      {
        "id": "인천_옹진군",
        "label": "인천_옹진군",
        "order": 57
      },
      {
        "id": "인천_중구",
        "label": "인천_중구",
        "order": 58
      },
      {
        "id": "광주_광산구",
        "label": "광주_광산구",
        "order": 59
      },
      {
        "id": "광주_남구",
        "label": "광주_남구",
        "order": 60
      },
      {
        "id": "광주_동구",
        "label": "광주_동구",
        "order": 61
      },
      {
        "id": "광주_북구",
        "label": "광주_북구",
        "order": 62
      },
      {
        "id": "광주_서구",
        "label": "광주_서구",
        "order": 63
      },
      {
        "id": "대전_대덕구",
        "label": "대전_대덕구",
        "order": 64
      },
      {
        "id": "대전_동구",
        "label": "대전_동구",
        "order": 65
      },
      {
        "id": "대전_서구",
        "label": "대전_서구",
        "order": 66
      },
      {
        "id": "대전_유성구",
        "label": "대전_유성구",
        "order": 67
      },
      {
        "id": "대전_중구",
        "label": "대전_중구",
        "order": 68
      },
      {
        "id": "울산_남구",
        "label": "울산_남구",
        "order": 69
      },
      {
        "id": "울산_동구",
        "label": "울산_동구",
        "order": 70
      },
      {
        "id": "울산_북구",
        "label": "울산_북구",
        "order": 71
      },
      {
        "id": "울산_울주군",
        "label": "울산_울주군",
        "order": 72
      },
      {
        "id": "울산_중구",
        "label": "울산_중구",
        "order": 73
      },
      {
        "id": "경기_가평군",
        "label": "경기_가평군",
        "order": 74
      },
      {
        "id": "경기_고양시",
        "label": "경기_고양시",
        "order": 75
      },
      {
        "id": "경기_과천시",
        "label": "경기_과천시",
        "order": 76
      },
      {
        "id": "경기_광명시",
        "label": "경기_광명시",
        "order": 77
      },
      {
        "id": "경기_광주시",
        "label": "경기_광주시",
        "order": 78
      },
      {
        "id": "경기_구리시",
        "label": "경기_구리시",
        "order": 79
      },
      {
        "id": "경기_군포시",
        "label": "경기_군포시",
        "order": 80
      },
      {
        "id": "경기_김포시",
        "label": "경기_김포시",
        "order": 81
      },
      {
        "id": "경기_남양주시",
        "label": "경기_남양주시",
        "order": 82
      },
      {
        "id": "경기_동두천시",
        "label": "경기_동두천시",
        "order": 83
      },
      {
        "id": "경기_부천시",
        "label": "경기_부천시",
        "order": 84
      },
      {
        "id": "경기_성남시",
        "label": "경기_성남시",
        "order": 85
      },
      {
        "id": "경기_수원시",
        "label": "경기_수원시",
        "order": 86
      },
      {
        "id": "경기_시흥시",
        "label": "경기_시흥시",
        "order": 87
      },
      {
        "id": "경기_안산시",
        "label": "경기_안산시",
        "order": 88
      },
      {
        "id": "경기_안성시",
        "label": "경기_안성시",
        "order": 89
      },
      {
        "id": "경기_안양시",
        "label": "경기_안양시",
        "order": 90
      },
      {
        "id": "경기_양주시",
        "label": "경기_양주시",
        "order": 91
      },
      {
        "id": "경기_양평군",
        "label": "경기_양평군",
        "order": 92
      },
      {
        "id": "경기_여주시",
        "label": "경기_여주시",
        "order": 93
      },
      {
        "id": "경기_연천군",
        "label": "경기_연천군",
        "order": 94
      },
      {
        "id": "경기_오산시",
        "label": "경기_오산시",
        "order": 95
      },
      {
        "id": "경기_용인시",
        "label": "경기_용인시",
        "order": 96
      },
      {
        "id": "경기_의왕시",
        "label": "경기_의왕시",
        "order": 97
      },
      {
        "id": "경기_의정부시",
        "label": "경기_의정부시",
        "order": 98
      },
      {
        "id": "경기_이천시",
        "label": "경기_이천시",
        "order": 99
      },
      {
        "id": "경기_파주시",
        "label": "경기_파주시",
        "order": 100
      },
      {
        "id": "경기_평택시",
        "label": "경기_평택시",
        "order": 101
      },
      {
        "id": "경기_포천시",
        "label": "경기_포천시",
        "order": 102
      },
      {
        "id": "경기_하남시",
        "label": "경기_하남시",
        "order": 103
      },
      {
        "id": "경기_화성시",
        "label": "경기_화성시",
        "order": 104
      },
      {
        "id": "강원도_강릉시",
        "label": "강원도_강릉시",
        "order": 105
      },
      {
        "id": "강원도_고성군",
        "label": "강원도_고성군",
        "order": 106
      },
      {
        "id": "강원도_동해시",
        "label": "강원도_동해시",
        "order": 107
      },
      {
        "id": "강원도_삼척시",
        "label": "강원도_삼척시",
        "order": 108
      },
      {
        "id": "강원도_속초시",
        "label": "강원도_속초시",
        "order": 109
      },
      {
        "id": "강원도_양구군",
        "label": "강원도_양구군",
        "order": 110
      },
      {
        "id": "강원도_양양군",
        "label": "강원도_양양군",
        "order": 111
      },
      {
        "id": "강원도_영월군",
        "label": "강원도_영월군",
        "order": 112
      },
      {
        "id": "강원도_원주시",
        "label": "강원도_원주시",
        "order": 113
      },
      {
        "id": "강원도_인제군",
        "label": "강원도_인제군",
        "order": 114
      },
      {
        "id": "강원도_정선군",
        "label": "강원도_정선군",
        "order": 115
      },
      {
        "id": "강원도_철원군",
        "label": "강원도_철원군",
        "order": 116
      },
      {
        "id": "강원도_춘천시",
        "label": "강원도_춘천시",
        "order": 117
      },
      {
        "id": "강원도_태백시",
        "label": "강원도_태백시",
        "order": 118
      },
      {
        "id": "강원도_평창군",
        "label": "강원도_평창군",
        "order": 119
      },
      {
        "id": "강원도_홍천군",
        "label": "강원도_홍천군",
        "order": 120
      },
      {
        "id": "강원도_화천군",
        "label": "강원도_화천군",
        "order": 121
      },
      {
        "id": "강원도_횡성군",
        "label": "강원도_횡성군",
        "order": 122
      },
      {
        "id": "충북_괴산군",
        "label": "충북_괴산군",
        "order": 123
      },
      {
        "id": "충북_단양군",
        "label": "충북_단양군",
        "order": 124
      },
      {
        "id": "충북_보은군",
        "label": "충북_보은군",
        "order": 125
      },
      {
        "id": "충북_영동군",
        "label": "충북_영동군",
        "order": 126
      },
      {
        "id": "충북_옥천군",
        "label": "충북_옥천군",
        "order": 127
      },
      {
        "id": "충북_음성군",
        "label": "충북_음성군",
        "order": 128
      },
      {
        "id": "충북_제천시",
        "label": "충북_제천시",
        "order": 129
      },
      {
        "id": "충북_증평군",
        "label": "충북_증평군",
        "order": 130
      },
      {
        "id": "충북_진천군",
        "label": "충북_진천군",
        "order": 131
      },
      {
        "id": "충북_청주시",
        "label": "충북_청주시",
        "order": 132
      },
      {
        "id": "충북_충주시",
        "label": "충북_충주시",
        "order": 133
      },
      {
        "id": "충남_계룡시",
        "label": "충남_계룡시",
        "order": 134
      },
      {
        "id": "충남_공주시",
        "label": "충남_공주시",
        "order": 135
      },
      {
        "id": "충남_금산군",
        "label": "충남_금산군",
        "order": 136
      },
      {
        "id": "충남_논산시",
        "label": "충남_논산시",
        "order": 137
      },
      {
        "id": "충남_당진시",
        "label": "충남_당진시",
        "order": 138
      },
      {
        "id": "충남_보령시",
        "label": "충남_보령시",
        "order": 139
      },
      {
        "id": "충남_부여군",
        "label": "충남_부여군",
        "order": 140
      },
      {
        "id": "충남_서산시",
        "label": "충남_서산시",
        "order": 141
      },
      {
        "id": "충남_서천군",
        "label": "충남_서천군",
        "order": 142
      },
      {
        "id": "충남_아산시",
        "label": "충남_아산시",
        "order": 143
      },
      {
        "id": "충남_예산군",
        "label": "충남_예산군",
        "order": 144
      },
      {
        "id": "충남_천안시",
        "label": "충남_천안시",
        "order": 145
      },
      {
        "id": "충남_청양군",
        "label": "충남_청양군",
        "order": 146
      },
      {
        "id": "충남_태안군",
        "label": "충남_태안군",
        "order": 147
      },
      {
        "id": "충남_홍성군",
        "label": "충남_홍성군",
        "order": 148
      },
      {
        "id": "전북_고창군",
        "label": "전북_고창군",
        "order": 149
      },
      {
        "id": "전북_군산시",
        "label": "전북_군산시",
        "order": 150
      },
      {
        "id": "전북_김제시",
        "label": "전북_김제시",
        "order": 151
      },
      {
        "id": "전북_남원시",
        "label": "전북_남원시",
        "order": 152
      },
      {
        "id": "전북_무주군",
        "label": "전북_무주군",
        "order": 153
      },
      {
        "id": "전북_부안군",
        "label": "전북_부안군",
        "order": 154
      },
      {
        "id": "전북_순창군",
        "label": "전북_순창군",
        "order": 155
      },
      {
        "id": "전북_익산시",
        "label": "전북_익산시",
        "order": 156
      },
      {
        "id": "전북_임실군",
        "label": "전북_임실군",
        "order": 157
      },
      {
        "id": "전북_장수군",
        "label": "전북_장수군",
        "order": 158
      },
      {
        "id": "전북_전주시",
        "label": "전북_전주시",
        "order": 159
      },
      {
        "id": "전북_정읍시",
        "label": "전북_정읍시",
        "order": 160
      },
      {
        "id": "전북_진안군",
        "label": "전북_진안군",
        "order": 161
      },
      {
        "id": "전남_강진군",
        "label": "전남_강진군",
        "order": 162
      },
      {
        "id": "전남_고흥군",
        "label": "전남_고흥군",
        "order": 163
      },
      {
        "id": "전남_곡성군",
        "label": "전남_곡성군",
        "order": 164
      },
      {
        "id": "전남_광양시",
        "label": "전남_광양시",
        "order": 165
      },
      {
        "id": "전남_구례군",
        "label": "전남_구례군",
        "order": 166
      },
      {
        "id": "전남_나주시",
        "label": "전남_나주시",
        "order": 167
      },
      {
        "id": "전남_담양군",
        "label": "전남_담양군",
        "order": 168
      },
      {
        "id": "전남_목포시",
        "label": "전남_목포시",
        "order": 169
      },
      {
        "id": "전남_무안군",
        "label": "전남_무안군",
        "order": 170
      },
      {
        "id": "전남_보성군",
        "label": "전남_보성군",
        "order": 171
      },
      {
        "id": "전남_순천시",
        "label": "전남_순천시",
        "order": 172
      },
      {
        "id": "전남_신안군",
        "label": "전남_신안군",
        "order": 173
      },
      {
        "id": "전남_여수시",
        "label": "전남_여수시",
        "order": 174
      },
      {
        "id": "전남_영광군",
        "label": "전남_영광군",
        "order": 175
      },
      {
        "id": "전남_영암군",
        "label": "전남_영암군",
        "order": 176
      },
      {
        "id": "전남_완도군",
        "label": "전남_완도군",
        "order": 177
      },
      {
        "id": "전남_장성군",
        "label": "전남_장성군",
        "order": 178
      },
      {
        "id": "전남_장흥군",
        "label": "전남_장흥군",
        "order": 179
      },
      {
        "id": "전남_진도군",
        "label": "전남_진도군",
        "order": 180
      },
      {
        "id": "전남_함평군",
        "label": "전남_함평군",
        "order": 181
      },
      {
        "id": "전남_해남군",
        "label": "전남_해남군",
        "order": 182
      },
      {
        "id": "전남_화순군",
        "label": "전남_화순군",
        "order": 183
      },
      {
        "id": "경북_경산시",
        "label": "경북_경산시",
        "order": 184
      },
      {
        "id": "경북_경주시",
        "label": "경북_경주시",
        "order": 185
      },
      {
        "id": "경북_고령군",
        "label": "경북_고령군",
        "order": 186
      },
      {
        "id": "경북_구미시",
        "label": "경북_구미시",
        "order": 187
      },
      {
        "id": "경북_군위군",
        "label": "경북_군위군",
        "order": 188
      },
      {
        "id": "경북_김천시",
        "label": "경북_김천시",
        "order": 189
      },
      {
        "id": "경북_문경시",
        "label": "경북_문경시",
        "order": 190
      },
      {
        "id": "경북_봉화군",
        "label": "경북_봉화군",
        "order": 191
      },
      {
        "id": "경북_상주시",
        "label": "경북_상주시",
        "order": 192
      },
      {
        "id": "경북_성주군",
        "label": "경북_성주군",
        "order": 193
      },
      {
        "id": "경북_안동시",
        "label": "경북_안동시",
        "order": 194
      },
      {
        "id": "경북_영덕군",
        "label": "경북_영덕군",
        "order": 195
      },
      {
        "id": "경북_영양군",
        "label": "경북_영양군",
        "order": 196
      },
      {
        "id": "경북_영주시",
        "label": "경북_영주시",
        "order": 197
      },
      {
        "id": "경북_영천시",
        "label": "경북_영천시",
        "order": 198
      },
      {
        "id": "경북_예천군",
        "label": "경북_예천군",
        "order": 199
      },
      {
        "id": "경북_울진군",
        "label": "경북_울진군",
        "order": 200
      },
      {
        "id": "경북_의성군",
        "label": "경북_의성군",
        "order": 201
      },
      {
        "id": "경북_청도군",
        "label": "경북_청도군",
        "order": 202
      },
      {
        "id": "경북_청송군",
        "label": "경북_청송군",
        "order": 203
      },
      {
        "id": "경북_칠곡군",
        "label": "경북_칠곡군",
        "order": 204
      },
      {
        "id": "경북_포항시",
        "label": "경북_포항시",
        "order": 205
      },
      {
        "id": "경남_거제시",
        "label": "경남_거제시",
        "order": 206
      },
      {
        "id": "경남_고성군",
        "label": "경남_고성군",
        "order": 207
      },
      {
        "id": "경남_김해시",
        "label": "경남_김해시",
        "order": 208
      },
      {
        "id": "경남_남해군",
        "label": "경남_남해군",
        "order": 209
      },
      {
        "id": "경남_밀양시",
        "label": "경남_밀양시",
        "order": 210
      },
      {
        "id": "경남_사천시",
        "label": "경남_사천시",
        "order": 211
      },
      {
        "id": "경남_산청군",
        "label": "경남_산청군",
        "order": 212
      },
      {
        "id": "경남_양산시",
        "label": "경남_양산시",
        "order": 213
      },
      {
        "id": "경남_의령군",
        "label": "경남_의령군",
        "order": 214
      },
      {
        "id": "경남_진주시",
        "label": "경남_진주시",
        "order": 215
      },
      {
        "id": "경남_창녕군",
        "label": "경남_창녕군",
        "order": 216
      },
      {
        "id": "경남_창원시",
        "label": "경남_창원시",
        "order": 217
      },
      {
        "id": "경남_하동군",
        "label": "경남_하동군",
        "order": 218
      },
      {
        "id": "경남_함안군",
        "label": "경남_함안군",
        "order": 219
      },
      {
        "id": "경남_함양군",
        "label": "경남_함양군",
        "order": 220
      },
      {
        "id": "경남_합천군",
        "label": "경남_합천군",
        "order": 221
      }
    ],
    "biz_reg_type": [
      {
        "id": "개인/면세",
        "label": "개인/면세",
        "order": 0
      },
      {
        "id": "개인/간이",
        "label": "개인/간이",
        "order": 1
      },
      {
        "id": "개인/일반",
        "label": "개인/일반",
        "order": 2
      },
      {
        "id": "개인/성실",
        "label": "개인/성실",
        "order": 3
      },
      {
        "id": "법인",
        "label": "법인",
        "order": 4
      },
      {
        "id": "법인/성실",
        "label": "법인/성실",
        "order": 5
      }
    ]
  },
  "boards": [
    {
      "slug": "newcust",
      "name": "🔥신규고객",
      "icon": "🔥",
      "description": "신규 상담 원장 — 유입부터 컨텍관리 이동까지",
      "mondayBoardId": "1816794539",
      "nameColumn": {
        "label": "업체명",
        "mondayLabel": "Name"
      },
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
          "key": "person",
          "label": "담당자",
          "type": "person",
          "width": 120
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
        }
      ]
    },
    {
      "slug": "contact",
      "name": "🔥컨텍관리",
      "icon": "🔥",
      "description": "계약 직전 단계 — 미팅·계약금·업무관리 인계",
      "mondayBoardId": "1816794566",
      "nameColumn": {
        "label": "업체명",
        "mondayLabel": "Name"
      },
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
      "nameColumn": {
        "label": "업체명",
        "mondayLabel": "이름"
      },
      "columns": [
        {
          "key": "project_owner",
          "label": "담당자",
          "type": "person",
          "width": 110
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
