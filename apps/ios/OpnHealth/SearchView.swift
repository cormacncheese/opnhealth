import SwiftUI

struct SearchView: View {
    @State private var query = ""
    @State private var results: [Product] = []
    @State private var status: String?

    var body: some View {
        List(results) { product in
            NavigationLink(value: product) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(product.name).font(.body.weight(.medium))
                    Text([product.brandName, product.gtin].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if let status {
                Text(status)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                    .id(status)
                    .transition(.opacity.combined(with: .offset(y: 6)))
            }
        }
        .animation(.easeOut(duration: 0.3), value: status)
        .navigationTitle("OpnHealth")
        .navigationDestination(for: Product.self) { ProductView(product: $0) }
        .searchable(text: $query, prompt: "Products, brands or barcodes")
        .task(id: query) { await search() }
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        guard term.count >= 2 else {
            results = []
            status = "Search the open record of what is in the products you buy."
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        status = "Searching for “\(term)”"
        do {
            results = try await API.search(term)
            status = results.isEmpty ? "No products match “\(term)”." : nil
        } catch {
            if !Task.isCancelled { status = "Search is unavailable right now. Try again shortly." }
        }
    }
}
