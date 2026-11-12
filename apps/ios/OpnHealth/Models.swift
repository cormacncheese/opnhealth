import Foundation

struct Product: Decodable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let brandName: String?
    let gtin: String?
    let servingSize: String?
    let ingredientsText: String?

    enum CodingKeys: String, CodingKey {
        case id, name, gtin
        case brandName = "brand_name"
        case servingSize = "serving_size"
        case ingredientsText = "ingredients_text"
    }
}

struct Measurement: Decodable, Identifiable {
    let id: UUID
    let submissionId: UUID?
    let analyteName: String?
    let analyteNameRaw: String?
    let `operator`: String?
    let value: Double?
    let unit: String?
    let loq: Double?
    let reportDate: String?
    let labName: String?
    let labAccreditationStatus: String?

    enum CodingKeys: String, CodingKey {
        case id, value, unit, loq, `operator`
        case submissionId = "submission_id"
        case analyteName = "analyte_name"
        case analyteNameRaw = "analyte_name_raw"
        case reportDate = "report_date"
        case labName = "lab_name"
        case labAccreditationStatus = "lab_accreditation_status"
    }

    var name: String { analyteName ?? analyteNameRaw ?? "Unnamed analyte" }

    /// The result as it reads on the report, e.g. "< 0.01 mg/kg".
    var formatted: String {
        let unit = unit ?? ""
        if `operator` == "nd" {
            return loq.map { "Not detected (below \(Self.number($0)) \(unit))" } ?? "Not detected"
        }
        let prefix = ["lt": "< ", "lte": "≤ ", "gt": "> ", "gte": "≥ "][`operator` ?? ""] ?? ""
        return "\(prefix)\(value.map(Self.number) ?? "") \(unit)".trimmingCharacters(in: .whitespaces)
    }

    static func number(_ n: Double) -> String {
        n.formatted(.number.precision(.significantDigits(1...4)))
    }
}

struct LedgerEvent: Decodable, Identifiable {
    let seq: Int
    let occurredAt: Date
    let eventType: String
    let subjectType: String
    let subjectId: String
    let actor: String
    let hash: String

    var id: Int { seq }

    enum CodingKeys: String, CodingKey {
        case seq, actor, hash
        case occurredAt = "occurred_at"
        case eventType = "event_type"
        case subjectType = "subject_type"
        case subjectId = "subject_id"
    }

    var actorLabel: String {
        if actor.hasPrefix("agent:") { return "\(actor.dropFirst(6).replacingOccurrences(of: "_", with: " ")) agent" }
        if actor.hasPrefix("system:connector:") { return "\(actor.dropFirst(17)) sync" }
        if actor.hasPrefix("system:") { return "the system" }
        return actor == "user" ? "a user" : actor
    }

    var title: String {
        eventType.replacingOccurrences(of: ".", with: " ").replacingOccurrences(of: "_", with: " ").capitalized
    }
}
