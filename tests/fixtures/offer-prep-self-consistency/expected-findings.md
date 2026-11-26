# Expected findings for contract-inconsistent.md and package-inconsistent.md

- id: F1 | kind: differs | topic: working time | a-at: 2 | a: "40 hours per week" | b-at: Annex A | b: "Weekly working time: 37.5 hours" | unit: hours
- id: F2 | kind: units | topic: vacation | a-at: 4 | a: "25 working days of paid vacation" | a-unit: working days | b-at: Annex A | b: "Vacation: 4 weeks" | b-unit: weeks | ask: "Which figure applies?"
- id: F3 | kind: differs | topic: salary | a-at: 3 | a: "annual base salary is 54,000" | b-at: Annex A | b: "Annual gross pay: 51,000" | unit: annual
- id: F4 | kind: depends | topic: relocation | at: 6 | quote: "two months of the salary stated in section 3" | base-at: 3
- id: F5 | kind: deferred | topic: bonus | at: 5 | quote: "as set out in the Company's bonus policy as amended from time to time" | refers: "the Company's bonus policy" | route: items
- id: F6 | kind: deferred | topic: notice | at: 7 | quote: "the notice period set out in the applicable collective agreement" | refers: "the applicable collective agreement" | route: items
- id: F7 | kind: deferred | topic: probation | at: 8 | quote: "the statutory notice period applies" | refers: "the statutory notice period" | route: lawyer
- id: F8 | kind: unreferenced | document: "IT Acceptable Use Acknowledgement"
- id: F9 | kind: unreferenced | document: "Data Protection Declaration"
