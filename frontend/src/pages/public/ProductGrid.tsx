import { Product } from "@/shared/types/models";
import { ProductCard } from "./ProductCard";
import "./ProductGrid.css";

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <section className="product-grid">
      {products.map((product) => (
        <ProductCard key={product.id ?? product.sku} product={product} />
      ))}
    </section>
  );
}
