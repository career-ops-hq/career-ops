# career-ops -- Mode tiếng Việt (`modes/vi/`)

Thư mục này chứa bộ mode tiếng Việt dành cho ứng viên nhắm tới thị trường lao động Việt Nam (công ty sản phẩm, outsourcing/offshore, startup, tập đoàn; các cổng như ITviec, TopCV, VietnamWorks, TopDev, CareerViet, LinkedIn).

Đây không phải bản dịch từng chữ của mode tiếng Anh. Mode đánh giá tin tuyển dụng theo từ vựng và quy ước của thị trường Việt Nam: Gross/Net, thử việc, BHXH/BHYT/BHTN, lương tháng 13, OT, hợp đồng lao động so với hợp đồng dịch vụ, và cách đọc các cụm như "Up to X" hay "Lương thỏa thuận".

## Khi nào dùng mode này?

Dùng `modes/vi/` nếu ít nhất một điều kiện sau đúng:

- Bạn ứng tuyển chủ yếu vào **tin tuyển dụng tiếng Việt** (ITviec, TopCV, VietnamWorks, TopDev, CareerViet, trang tuyển dụng của công ty)
- **CV của bạn bằng tiếng Việt**, hoặc bạn chuyển đổi giữa tiếng Việt và tiếng Anh tùy tin
- Bạn cần câu trả lời và cover letter bằng **tiếng Việt kỹ thuật tự nhiên**, không phải bản dịch máy
- Bạn cần xử lý **đặc thù lao động Việt Nam**: Gross/Net, thử việc, BHXH, lương tháng 13, OT, thời gian báo trước, hợp đồng lao động xác định/không xác định thời hạn

Nếu đa số tin của bạn bằng tiếng Anh (ví dụ công ty nước ngoài tuyển remote), cứ dùng mode tiêu chuẩn trong `modes/`; mode tiếng Anh vẫn chạy được với tin ở Việt Nam, chỉ là không hiểu chi tiết thị trường.

## Cách kích hoạt

### Cách 1 -- Theo phiên

Nói với Claude ở đầu phiên:

> "Dùng mode tiếng Việt trong `modes/vi/`."

### Cách 2 -- Cố định

Thêm vào `config/profile.yml`:

```yaml
language:
  output: vi
  modes_dir: modes/vi
```

`language.output` quyết định ngôn ngữ của văn bản dành cho người đọc (báo cáo, ghi chú tracker, cover letter...). `language.modes_dir` chỉ cung cấp từ vựng và quy tắc thị trường. Hai trục này độc lập: ví dụ có thể để `output: en` và vẫn dùng `modes_dir: modes/vi`. Xem `AGENTS.md` → "Output Language vs Market Modes".

## Các tệp trong mode này

| Tệp | Dịch từ | Vai trò |
|-----|---------|---------|
| `_shared.md` | `modes/_shared.md` | Ngữ cảnh chung, archetype, hệ thống chấm điểm, quy tắc toàn cục, đặc thù thị trường Việt Nam |
| `tuyen-dung.md` | `modes/oferta.md` | Đánh giá đầy đủ một tin tuyển dụng (Block A-G, Risk Summary, Block H) |
| `ung-tuyen.md` | `modes/apply.md` | Trợ lý điền form ứng tuyển trực tiếp (bản rút gọn) |
| `pipeline.md` | `modes/pipeline.md` | Hộp thư URL / Second Brain cho các tin đã thu thập |

Các mode còn lại (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`, `interview/*`...) dùng bản chuẩn trong `modes/`. Nội dung chủ yếu là công cụ, đường dẫn và lệnh -- cần độc lập với ngôn ngữ. Các mode phỏng vấn (`plan`, `practice`, `debrief`) chưa có bản tiếng Việt.

## Những gì giữ nguyên tiếng Anh

Cố ý không dịch vì script hoặc giao diện web đọc theo tên:

- Tiêu đề báo cáo `## Machine Summary`, `## Risk Summary`, `## A) ...` đến `## H) ...` và các nhãn header `**Date:**`, `**URL:**`, `**Archetype:**`, `**Score:**`, `**Legitimacy:**`, `**Work Auth:**`, `**PDF:**`
- Tên cột bảng Block B (`Requirement`, `Importance`, `Match`, `JD signal`, `Evidence / gap`) và bảng `| Signal | Status |` của Risk Summary
- Khóa YAML và giá trị enum trong Machine Summary
- Tiêu đề mục `## Pending` / `## Processed` trong `data/pipeline.md` (vì `scan.mjs` và `reconcile-pipeline.mjs` chỉ nhận cách viết tiếng Anh và tiếng Tây Ban Nha)
- Giá trị trạng thái trong tracker (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`...)
- Tên công cụ (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`), đoạn mã, đường dẫn, lệnh
- Thuật ngữ kỹ thuật phổ biến trong ngành: stack, pipeline, deployment, embedding, proof point, archetype...

## Các giả định về thị trường Việt Nam (để bạn phản biện)

Phần này ghi lại những gì đã được mã hóa, để người sau có thể tranh luận hoặc cập nhật:

1. **Luật và số liệu thay đổi.** Các mô tả về thử việc, bảo hiểm, nghỉ phép, thời gian báo trước, trợ cấp thôi việc dựa trên Bộ luật Lao động 2019 (45/2019/QH14). Mức giảm trừ gia cảnh, lương tối thiểu vùng và mức đóng bảo hiểm thay đổi theo thời kỳ, nên mode **không hardcode** các con số đó và luôn coi chúng là câu hỏi cần đối chiếu văn bản hiện hành. Đây là danh sách điều cần kiểm tra, không phải tư vấn pháp lý.
2. **Lương Net/Gross và USD/VND.** Nhiều tin IT quảng cáo lương theo USD Net trong khi hợp đồng ký bằng VND. Mode luôn buộc làm rõ Gross hay Net, loại tiền, tỷ giá và mức lương làm căn cứ đóng bảo hiểm, và không tự quy đổi bằng giả định ngầm.
3. **Cách đọc cụm từ trong tin.** "Up to X" là trần, "Lương thỏa thuận"/"Cạnh tranh" là chưa có thông tin lương, khoảng quá rộng thường gồm KPI/hoa hồng, "chịu được áp lực cao" cần hỏi thêm về OT. Đây là kinh nghiệm thị trường, được gắn nhãn là gợi ý, không phải phán quyết.
4. **Loại hình công ty.** Block D phân loại thêm outsourcing/offshore/ODC và outstaff, vì độ tin cậy của con số lương và rủi ro OT khác nhau rõ rệt giữa các loại.
5. **Tín hiệu lừa đảo tuyển dụng (Block G, Signal 16).** Đây là phần **bổ sung riêng cho Việt Nam**, không có trong mode chuẩn: đặt cọc/thu phí, liên hệ chỉ qua Zalo/Telegram/email cá nhân, "việc nhẹ lương cao", làm nhiệm vụ online, đa cấp. Khác với các tín hiệu 6-15 (trực giao với tầng độ tin cậy), tín hiệu này có thể kéo tầng về **Suspicious** khi có từ 2 dấu hiệu trở lên. Nếu maintainers muốn giữ nó trực giao như các tín hiệu khác, chỉ cần sửa một đoạn trong `tuyen-dung.md`.
6. **Các tín hiệu theo bảng khu vực (10, 11, 12, 15).** Bốn bảng `templates/agency-licensing.yml`, `immigration-status-requirements.yml`, `jurisdiction-prohibited-content.yml`, `jurisdiction-ai-screening-disclosure.yml` hiện chưa có dòng cho Việt Nam. Mode ghi rõ rằng khi không có dòng thì bỏ qua một cách im lặng, đúng như mode chuẩn. Khi ai đó thêm dòng Việt Nam vào các bảng đó, mode tự dùng được mà không cần sửa.
7. **Không có phần "PcD-quota" của Brazil.** Kiểm tra hạn ngạch PcD ở Block A của mode chuẩn chỉ dành cho thị trường Brazil và không được đưa vào đây.
8. **Thông tin cá nhân trên CV.** Ở Việt Nam, ảnh thẻ, ngày sinh, giới tính, tình trạng hôn nhân thường xuất hiện trên CV. Mode không tự thêm bất kỳ trường nào không có trong `cv.md`; việc có đưa vào hay không là quyết định của ứng viên.
9. **Chức danh.** Thang chức danh phổ biến: Intern / Fresher / Junior / Middle / Senior / Lead / Principal. Mapping giữa công ty outsourcing và công ty sản phẩm có thể lệch, và Block C nhắc điều đó nhưng không cố chuẩn hóa.
10. **Các cổng việc làm.** Có provider cho ITviec và CareerViet trong `providers/` (xem `docs/SUPPORTED_JOB_BOARDS.md`). TopCV, VietnamWorks, TopDev... không có provider tự động; với các cổng đó, dán nội dung tin vào hoặc dùng `local:jds/...`. Mode xử lý tin từ cổng tổng hợp theo quy tắc "Aggregator Listings" trong `AGENTS.md`: tin ở cổng là chưa xác nhận cho đến khi tìm thấy ở trang tuyển dụng của nhà tuyển dụng.

## Bảng thuật ngữ tham chiếu

Để giữ giọng văn nhất quán khi bạn sửa hoặc mở rộng các mode:

| Tiếng Anh | Tiếng Việt (trong codebase này) |
|-----------|----------------------------------|
| Job posting | Tin tuyển dụng |
| Application | Hồ sơ ứng tuyển / Đơn ứng tuyển |
| Cover letter | Cover letter / Thư ứng tuyển |
| Resume / CV | CV |
| Salary | Lương |
| Compensation | Đãi ngộ / Gói đãi ngộ |
| Skills | Kỹ năng |
| Interview | Phỏng vấn |
| Hiring manager | Hiring manager / Quản lý tuyển dụng |
| Recruiter | Recruiter / Nhà tuyển dụng |
| AI | AI (Trí tuệ nhân tạo) |
| Requirements | Yêu cầu |
| Career history | Lịch sử nghề nghiệp |
| Notice period | Thời gian báo trước |
| Probation | Thử việc |
| 13th-month salary | Lương tháng 13 |
| Tet bonus | Thưởng Tết |
| Permanent employment | Hợp đồng lao động không xác định thời hạn |
| Fixed-term contract | Hợp đồng lao động xác định thời hạn |
| Freelance / contractor | Freelance / Hợp đồng dịch vụ / Cộng tác viên |
| Severance | Trợ cấp thôi việc |
| Social / health / unemployment insurance | BHXH / BHYT / BHTN |
| Base salary | Lương cơ bản |
| Allowances | Phụ cấp |
| Income tax | Thuế TNCN |
| Gross / Net | Gross / Net |
| Overtime | Tăng ca / OT |
| Annual leave | Nghỉ phép năm |
| Outsourcing | Gia công phần mềm / Outsourcing |

## Đóng góp

Để sửa bản dịch hoặc bổ sung mode:

1. Mở Issue nêu đề xuất của bạn (xem `CONTRIBUTING.md`)
2. Tuân theo bảng thuật ngữ ở trên để giữ giọng văn nhất quán
3. Dịch theo ý, không dịch từng chữ
4. Giữ nguyên các thành phần cấu trúc (Block A-H, bảng, khối mã, chỉ dẫn công cụ) -- các script và giao diện web đọc chúng theo tên
5. Kiểm tra bằng tin tuyển dụng Việt Nam thật (ITviec, TopCV, VietnamWorks...) trước khi gửi PR
6. Chạy `node i18n-drift.mjs --lang vi` để kiểm tra độ phủ cấu trúc so với mode chuẩn
