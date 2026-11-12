import SwiftUI

/// The newest ledger entries: every agent decision, sync and correction.
struct LedgerView: View {
    @State private var events: [LedgerEvent] = []
    @State private var failed = false

    var body: some View {
        List(events) { event in
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("#\(event.seq)").font(.footnote.monospaced()).foregroundStyle(.secondary).frame(width: 52, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.title).font(.body.weight(.medium))
                    Text("By \(event.actorLabel) · \(event.occurredAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if failed && events.isEmpty {
                Text("The ledger could not be loaded. Pull to try again.").foregroundStyle(.secondary).padding()
            }
        }
        .navigationTitle("Ledger")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            events = try await API.latestEvents()
            failed = false
        } catch {
            failed = true
        }
    }
}
