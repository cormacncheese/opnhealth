import Foundation
import Supabase

/// Reads the same public API as the website, as an anonymous visitor.
enum API {
    static let client: SupabaseClient = {
        let info = Bundle.main.infoDictionary ?? [:]
        let url = URL(string: info["SupabaseURL"] as? String ?? "") ?? URL(string: "http://127.0.0.1:55321")!
        return SupabaseClient(supabaseURL: url, supabaseKey: info["SupabaseKey"] as? String ?? "")
    }()

    static func search(_ query: String) async throws -> [Product] {
        struct Params: Encodable { let q: String; let max_results: Int }
        return try await client.rpc("search_products", params: Params(q: query, max_results: 25)).execute().value
    }

    static func product(_ id: UUID) async throws -> Product {
        try await client.from("products").select().eq("id", value: id).single().execute().value
    }

    static func results(for productID: UUID) async throws -> [Measurement] {
        try await client.from("published_measurements").select()
            .eq("product_id", value: productID)
            .order("report_date", ascending: false)
            .execute().value
    }

    static func latestEvents(limit: Int = 50) async throws -> [LedgerEvent] {
        try await client.from("events")
            .select("seq, occurred_at, event_type, subject_type, subject_id, actor, hash")
            .order("seq", ascending: false)
            .limit(limit)
            .execute().value
    }
}
