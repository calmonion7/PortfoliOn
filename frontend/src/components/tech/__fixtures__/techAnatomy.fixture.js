// 라이브 실발행분(solid-state-battery, 2026-08-19)에서 **복사**한 픽스처 — 손으로 지어내지 않는다.
// 지어낸 픽스처는 fixture-pass-live-fail의 입구다(이 저장소가 반복해 밟은 경로).
export const LIVE_SSB = {
  "composition": {
    "tech": [
      {
        "name": "대면적 전해질층 무결점 성막·적층",
        "leaders": [
          "삼성SDI",
          "토요타",
          "Gotion(궈쉬안)"
        ],
        "rationale": "파일럿 조립수율 70~90%와 상용 기준선 95%의 격차가 거의 전부 이 공정에서 나온다 — 결점 하나가 셀 하나를 버리므로 남은 난제 중 가장 큰 몫이다.",
        "share_pct": 35.0
      },
      {
        "name": "전해질 소재 양산·연속화",
        "leaders": [
          "이데미쓰코산"
        ],
        "rationale": "황화물 전해질은 아직 배치 공정 비중이 높아 단가·품질 편차가 크고, 셀 라인보다 소재 라인이 앞서 있어야 2027년 양산 일정이 성립한다.",
        "share_pct": 25.0
      },
      {
        "name": "무가압·저가압 계면 유지",
        "leaders": [
          "토요타",
          "QuantumScape"
        ],
        "rationale": "MPa급 스택 압력 없이 계면 접촉을 유지하는 설계가 미확립이다 — 차량 팩에서 가압 구조물을 뺄 수 있느냐가 실장 가능성을 가른다.",
        "share_pct": 20.0
      },
      {
        "name": "고전류밀도 덴드라이트 억제",
        "leaders": [
          "삼성SDI",
          "Solid Power"
        ],
        "rationale": "결정립계·공극을 따른 리튬 침투 경로가 남아 있어 급속충전 조건의 수명을 제한한다. 계면층 설계와 압력 조건을 동시에 만족시켜야 한다.",
        "share_pct": 15.0
      },
      {
        "name": "기타(팩·BMS·안전 통합)",
        "leaders": [],
        "rationale": "셀 수준 난제가 풀린 뒤 남는 통합 과제로, 액체 전해질 팩의 축적 기술을 상당 부분 재사용할 수 있어 잔여 몫으로 둔다.",
        "share_pct": 5.0
      }
    ],
    "experts": [
      {
        "name": "고체 전해질 합성·정제",
        "rationale": "황화리튬 순도와 연속공정을 동시에 아는 인력이 극소수이고, 소재 라인이 셀 라인의 선행 조건이라 병목이 가장 앞단에 있다.",
        "share_pct": 35.0
      },
      {
        "name": "대면적 성막·적층 공정",
        "rationale": "수율이 곧 원가인 국면이라 결점 통계를 읽고 공정 창을 좁혀본 경험자가 직접적인 진척 속도를 정한다.",
        "share_pct": 30.0
      },
      {
        "name": "계면·전기화학 해석",
        "rationale": "덴드라이트 침투와 계면 저항을 함께 모델링할 수 있는 인력은 학계에 얇게 분포해 기업이 내부 육성에 의존한다.",
        "share_pct": 20.0
      },
      {
        "name": "초저습·황화수소 안전 설비",
        "rationale": "황화물 계열의 필수 부대조건인데 배터리 업계 밖(화학 플랜트)에 있던 역량이라 채용 경로 자체가 다르다.",
        "share_pct": 15.0
      }
    ],
    "minerals": [
      {
        "name": "리튬",
        "used_in": [
          "전해질 소재 양산·연속화",
          "대면적 전해질층 무결점 성막·적층"
        ],
        "producers": [
          {
            "name": "앨버말",
            "ticker": "ALB",
            "country": "US",
            "share_pct": null
          },
          {
            "name": "SQM",
            "ticker": "SQM",
            "country": "CL",
            "share_pct": null
          },
          {
            "name": "간펑리튬",
            "ticker": "002460",
            "country": "CN",
            "share_pct": null
          }
        ],
        "rationale": "황화물 셀 원가의 70~80%가 고체 전해질이고 그 원가의 70~80%가 황화리튬이라, 리튬이 원재료비에서 압도적 단일 항목이 된다.",
        "share_pct": 50.0,
        "top_source_pct": 40.0,
        "top_source_country": "호주"
      },
      {
        "name": "니켈",
        "used_in": [
          "대면적 전해질층 무결점 성막·적층"
        ],
        "producers": [
          {
            "name": "칭산홀딩스",
            "ticker": null,
            "country": "CN",
            "share_pct": null
          },
          {
            "name": "Vale",
            "ticker": "VALE",
            "country": "BR",
            "share_pct": null
          }
        ],
        "rationale": "하이니켈 양극이 에너지밀도 목표를 지탱하는 한 양극 원가의 주축이며, 인도네시아 편중이 가격 변동을 그대로 셀 원가로 전달한다.",
        "share_pct": 20.0,
        "top_source_pct": 61.0,
        "top_source_country": "인도네시아"
      },
      {
        "name": "은",
        "used_in": [
          "무가압·저가압 계면 유지"
        ],
        "producers": [
          {
            "name": "Fresnillo",
            "ticker": "FRES",
            "country": "MX",
            "share_pct": null
          }
        ],
        "rationale": "삼성SDI 계열의 Ag-C 음극층이 은을 쓴다 — 사용량은 적지만 단가가 높아 무음극 전환 전까지 원가에 남는다.",
        "share_pct": 10.0,
        "top_source_pct": null,
        "top_source_country": "멕시코"
      },
      {
        "name": "코발트",
        "used_in": [
          "대면적 전해질층 무결점 성막·적층"
        ],
        "producers": [
          {
            "name": "CMOC",
            "ticker": "603993",
            "country": "CN",
            "share_pct": null
          },
          {
            "name": "Glencore",
            "ticker": "GLEN",
            "country": "CH",
            "share_pct": null
          }
        ],
        "rationale": "양극 구조 안정화에 남아 있고 콩고민주공화국 73% 편중이라 공급 리스크가 가격에 선반영된다 — 탈코발트가 진행될수록 이 몫은 줄어든다.",
        "share_pct": 10.0,
        "top_source_pct": 73.0,
        "top_source_country": "콩고민주공화국"
      },
      {
        "name": "황·인(P2S5 원료)",
        "used_in": [
          "전해질 소재 양산·연속화"
        ],
        "producers": [
          {
            "name": "이데미쓰코산",
            "ticker": "5019",
            "country": "JP",
            "share_pct": null
          }
        ],
        "rationale": "아지로다이트계 전해질의 골격 원소다. 광물 자체는 저렴하나 배터리급 고순도·초저습 취급 요구가 실질 원가를 만든다.",
        "share_pct": 10.0,
        "top_source_pct": null,
        "top_source_country": "중국"
      }
    ],
    "minerals_share_basis": null
  },
  "players": [
    {
      "name": "삼성SDI",
      "country": "한국",
      "ticker": "006400",
      "tech_level": 5
    },
    {
      "name": "토요타",
      "country": "일본",
      "ticker": "TM",
      "tech_level": 5
    },
    {
      "name": "이데미쓰코산",
      "country": "일본",
      "ticker": null,
      "tech_level": 4
    },
    {
      "name": "Gotion(궈쉬안)",
      "country": "중국",
      "ticker": null,
      "tech_level": 4
    },
    {
      "name": "닛산",
      "country": "일본",
      "ticker": null,
      "tech_level": 4
    },
    {
      "name": "CATL",
      "country": "중국",
      "ticker": null,
      "tech_level": 3
    },
    {
      "name": "BYD",
      "country": "중국",
      "ticker": null,
      "tech_level": 3
    },
    {
      "name": "SK온",
      "country": "한국",
      "ticker": "096770",
      "tech_level": 3
    },
    {
      "name": "LG에너지솔루션",
      "country": "한국",
      "ticker": "373220",
      "tech_level": 3
    },
    {
      "name": "QuantumScape",
      "country": "미국",
      "ticker": "QS",
      "tech_level": 3
    },
    {
      "name": "Solid Power",
      "country": "미국",
      "ticker": "SLDP",
      "tech_level": 3
    },
    {
      "name": "현대차",
      "country": "한국",
      "ticker": "005380",
      "tech_level": 3
    }
  ]
}
