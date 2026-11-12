import { ButtonLink, PageTitle } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <PageTitle title="Nothing at this address">
        The page may have moved, or the link may be incomplete. Records are never deleted, so if you are
        looking for one, search for the product or browse the ledger.
      </PageTitle>
      <ButtonLink href="/">Search products</ButtonLink>
    </>
  );
}
