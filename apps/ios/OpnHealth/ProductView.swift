import SwiftUI

struct ProductView: View {
    let product: Product
    @State private var results: [Measurement]?
    @State private var failed = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    if let brand = product.brandName {
                        Text(brand).foregroundStyle(.secondary)
                    }
                    Text(product.name).font(.title2.weight(.semibold))
                    if let gtin = product.gtin {
                        Text("Barcode \(gtin)").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }

            Section("Lab results") {
                if failed {
                    Text("Results could not be loaded. Pull to try again.").foregroundStyle(.secondary)
                } else if let results {
                    if results.isEmpty {
                        Text("No lab reports have been published for this product yet.").foregroundStyle(.secondary)
                    }
                    ForEach(results) { m in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(m.name).font(.body.weight(.semibold))
                                Spacer()
                                Text(m.formatted).font(.body.weight(.semibold))
                            }
                            Text([m.labName, m.reportDate.map { "Report dated \($0)" }].compactMap { $0 }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.secondary)
                            if m.labAccreditationStatus != "verified" {
                                Text("Lab accreditation not yet confirmed").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    ProgressView()
                }
            }

            if let ingredients = product.ingredientsText {
                Section("Ingredients") { Text(ingredients).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Product")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            results = try await API.results(for: product.id)
            failed = false
        } catch {
            failed = true
        }
    }
}
