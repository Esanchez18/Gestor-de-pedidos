export interface CatalogCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CatalogProduct {
  id: string;
  title: string;
  slug: string;
  description: string;
  image_path: string | null;
  category_id: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogPrivateFile {
  product_id: string;
  stl_url: string | null;
  stl_path: string | null;
  updated_at: string;
}

export interface CatalogProductDraft {
  id: string;
  title: string;
  description: string;
  category_id: string;
  is_published: boolean;
  image: File | null;
  stl_url: string;
  stl_file: File | null;
  clear_stl: boolean;
  previous_image_path: string | null;
  previous_stl_path: string | null;
}
