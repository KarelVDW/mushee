/**
 * A page's structured data, as one `<script type="application/ld+json">`. Several
 * entities go in as one array, so they stay a single script. `<` is escaped so no
 * string inside can close the script tag early.
 */
export function JsonLd({ data }: { data: object }) {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}
