# frozen_string_literal: true

# Graph — Four-signal knowledge graph + Louvain community detection
#
# Faithfully replicates the original graph-relevance.ts:
# Signal 1: Direct wikilinks (weight 3.0)
# Signal 2: Source overlap (weight 4.0)
# Signal 3: Common neighbors / Adamic-Adar (weight 1.5)
# Signal 4: Type affinity (weight 1.0)

require "digest/sha2"

module Graph
  extend self

  CACHE_VERSION = 2
  CONFIG_LOCK = ".llm-wiki/graph-config.lock"

  # No project is forced into a global taxonomy. Types are observed from real
  # pages or explicitly confirmed and saved by the onboarding/organizing agent.
  DEFAULT_TYPES = {}.freeze

  TYPE_COLORS = %w[#2563eb #7c3aed #db2777 #ea580c #16a34a #0891b2 #4f46e5 #c026d3 #ca8a04 #0f766e].freeze

  WEIGHTS = {
    direct_link: 3.0,
    source_overlap: 4.0,
    common_neighbor: 1.5,
    type_affinity: 1.0
  }.freeze

  TYPE_AFFINITY = {
    "entity"    => { "concept" => 1.2, "entity" => 0.8, "source" => 1.0, "synthesis" => 1.0, "query" => 0.8 },
    "concept"   => { "entity" => 1.2, "concept" => 0.8, "source" => 1.0, "synthesis" => 1.2, "query" => 1.0 },
    "source"    => { "entity" => 1.0, "concept" => 1.0, "source" => 0.5, "query" => 0.8, "synthesis" => 1.0 },
    "query"     => { "concept" => 1.0, "entity" => 0.8, "synthesis" => 1.0, "source" => 0.8, "query" => 0.5 },
    "synthesis" => { "concept" => 1.2, "entity" => 1.0, "source" => 1.0, "query" => 1.0, "synthesis" => 0.8 }
  }.freeze

  # Build full graph data for visualization (nodes + edges + communities)
  def build(project_path)
    md_files = graph_markdown_files(project_path)
    signature = graph_signature(project_path, md_files)
    cached = load_graph_cache(project_path, signature)
    return cached if cached

    nodes_map = build_nodes(project_path, md_files: md_files)
    edges = build_edges(nodes_map)
    communities = louvain(nodes_map, edges)
    importance = calculate_importance(nodes_map, communities)
    config = graph_config(project_path, nodes_map.values.map { |node| node[:type] })

    all_nodes = nodes_map.values.map { |node|
      neighbors = (node[:out_links] + node[:in_links]).uniq
      {
        "id" => node[:id],
        "title" => node[:title],
        "type" => node[:type],
        "path" => node[:path],
        "sources" => node[:sources],
        "degree" => neighbors.size,
        "out_degree" => node[:out_links].size,
        "in_degree" => node[:in_links].size,
        "community" => communities[node[:id]] || 0,
        "importance" => importance.dig(node[:id], :score) || 0.0,
        "centrality" => importance.dig(node[:id], :pagerank) || 0.0,
        "bridge_score" => importance.dig(node[:id], :bridge) || 0.0,
        "declared_importance" => node[:declared_importance] || 0.0
      }
    }
    data = {
      # Keep the complete index. Large-vault performance is handled by the
      # persistent cache and the browser's lightweight physics mode, never by
      # silently dropping pages from the user's graph.
      "nodes" => all_nodes.map { |node| node.reject { |key, _| key == "declared_importance" } },
      "edges" => edges.map { |e|
        {
          "source" => e[:source],
          "target" => e[:target],
          "weight" => e[:weight],
          "bidirectional" => e[:bidirectional],
          "label" => e[:label]
        }
      },
      "types" => config["types"].map { |id, value| value.merge("id" => id, "count" => nodes_map.values.count { |node| node[:type] == id }) },
      "stats" => {
        "node_count" => nodes_map.size,
        "edge_count" => edges.size,
        "bidirectional_count" => edges.count { |edge| edge[:bidirectional] },
        "community_count" => communities.values.uniq.size
      }
    }
    save_graph_cache(project_path, signature, data)
    data
  end

  def graph_config(project_path, observed_types = nil)
    path = config_path(project_path)
    stored = File.exist?(path) ? JSON.parse(File.read(path, encoding: "utf-8")) : {}
    raise ArgumentError, "Graph settings are invalid; the original file has been preserved" unless stored.is_a?(Hash)
    # A parseable outer object can still contain damaged category data. Do not
    # turn it into an empty config and overwrite the original on the next save.
    %w[types labels].each do |field|
      next unless stored.key?(field)
      value = stored[field]
      valid = value.is_a?(Hash) && value.values.all? { |type| type.is_a?(Hash) }
      raise ArgumentError, "Graph settings are invalid; the original file has been preserved" unless valid
    end
    types = DEFAULT_TYPES.transform_values(&:dup)
    # Early agent prompts described this as labels/display while the runtime
    # contract is types/label. Read both shapes so projects created by an older
    # prompt remain usable; the next UI save writes the canonical shape.
    legacy_types = stored["labels"].is_a?(Hash) ? stored["labels"] : {}
    canonical_types = stored["types"].is_a?(Hash) ? stored["types"] : {}
    stored_types = legacy_types.merge(canonical_types)
    stored_types.each do |id, value|
      next unless value.is_a?(Hash)
      key = normalize_type(id)
      display_label = value["label"].to_s.strip
      display_label = value["display"].to_s.strip if display_label.empty?
      types[key] = {
        "label" => display_label.empty? ? humanize_type(key) : display_label,
        "color" => valid_color(value["color"]) || color_for(key)
      }
    end
    Array(observed_types).each do |id|
      key = normalize_type(id)
      types[key] ||= { "label" => humanize_type(key), "color" => color_for(key) }
    end
    { "types" => types }
  end

  def save_graph_config(project_path, input)
    Storage.with_lock(File.join(project_path, CONFIG_LOCK)) do
      current = graph_config(project_path)
      submitted = input.is_a?(Hash) && input["types"].is_a?(Hash) ? input["types"] : {}
      submitted.each do |id, value|
        next unless value.is_a?(Hash)
        key = normalize_type(id)
        current["types"][key] = {
          "label" => value["label"].to_s.strip.empty? ? humanize_type(key) : value["label"].to_s.strip[0, 40],
          "color" => valid_color(value["color"]) || current.dig("types", key, "color") || color_for(key)
        }
      end
      FileUtils.mkdir_p(File.dirname(config_path(project_path)))
      Storage.atomic_write(config_path(project_path), JSON.pretty_generate(current), encoding: "utf-8")
      invalidate_cache(project_path)
      current
    end
  end

  def delete_type(project_path, id)
    Storage.with_lock(File.join(project_path, CONFIG_LOCK)) do
      aliases = WikiEngine.configured_type_aliases(project_path)
      key = WikiEngine.canonical_page_type_id(project_path, id, aliases: aliases)
      current = graph_config(project_path)
      unless current["types"].key?(key)
        next({ "ok" => false, "status" => 404, "error" => "Category not found" })
      end

      wiki_dir = File.join(project_path, "wiki")
      used_paths = Dir.glob(File.join(wiki_dir, "**", "*.md")).each_with_object([]) do |file, paths|
        relative = file.sub("#{wiki_dir}/", "")
        begin
          content = File.read(file, encoding: "utf-8")
        rescue StandardError
          next
        end
        frontmatter = WikiEngine.parse_frontmatter(content)
        page_type = WikiEngine.canonical_page_type(
          project_path,
          frontmatter["type"],
          relative,
          aliases: aliases
        )
        paths << relative if page_type == key
      end
      if used_paths.any?
        next({
          "ok" => false,
          "status" => 409,
          "error" => "Move or delete the articles in this category first",
          "pages" => used_paths
        })
      end

      SidebarOrder.delete_type(project_path, key) if defined?(SidebarOrder)
      current["types"].delete(key)
      FileUtils.mkdir_p(File.dirname(config_path(project_path)))
      Storage.atomic_write(config_path(project_path), JSON.pretty_generate(current), encoding: "utf-8")
      invalidate_cache(project_path)
      { "ok" => true, "deleted_type" => key, "types" => current["types"] }
    end
  end

  # Get related nodes for a specific node (4-signal relevance)
  def related_nodes(project_path, node_id, limit = 10)
    nodes_map = build_nodes(project_path)
    source_node = nodes_map[node_id]
    return [] unless source_node

    scored = nodes_map.values.reject { |n| n[:id] == node_id }.map { |n|
      { node: n, relevance: calculate_relevance(source_node, n, nodes_map) }
    }.select { |r| r[:relevance] > 0 }

    scored.sort_by { |r| -r[:relevance] }.first(limit).map { |r|
      {
        "id" => r[:node][:id],
        "title" => r[:node][:title],
        "type" => r[:node][:type],
        "relevance" => r[:relevance].round(3)
      }
    }
  end

  # Detect communities using Louvain algorithm
  def detect_communities(project_path)
    nodes_map = build_nodes(project_path)
    edges = build_edges(nodes_map)
    community_map = louvain(nodes_map, edges)

    # Group by community
    grouped = {}
    community_map.each do |node_id, comm_id|
      grouped[comm_id] ||= []
      node = nodes_map[node_id]
      grouped[comm_id] << {
        "id" => node_id,
        "title" => node[:title],
        "type" => node[:type]
      }
    end

    grouped.map { |id, members|
      { "id" => id, "size" => members.size, "members" => members }
    }.sort_by { |c| -c["size"] }
  end

  # Compute graph insights (surprise connections, knowledge gaps, bridge nodes)
  def compute_insights(project_path)
    nodes_map = build_nodes(project_path)
    edges = build_edges(nodes_map)

    # Surprise connections: high relevance but no direct link
    surprises = []
    nodes_list = nodes_map.values
    nodes_list.combination(2) do |a, b|
      next if a[:out_links].include?(b[:id]) || b[:out_links].include?(a[:id])
      rel = calculate_relevance(a, b, nodes_map)
      if rel > 5.0
        surprises << {
          "node_a" => { "id" => a[:id], "title" => a[:title] },
          "node_b" => { "id" => b[:id], "title" => b[:title] },
          "relevance" => rel.round(3),
          "reason" => infer_connection_reason(a, b, nodes_map)
        }
      end
    end
    surprises = surprises.sort_by { |s| -s["relevance"] }.first(10)

    # Knowledge gaps: nodes with high in-degree but few outlinks (information sinks)
    gaps = nodes_map.values
      .select { |n| n[:in_links].size > 3 && n[:out_links].size < 2 }
      .map { |n| { "id" => n[:id], "title" => n[:title], "in_degree" => n[:in_links].size, "out_degree" => n[:out_links].size } }
      .sort_by { |g| -g["in_degree"] }
      .first(10)

    # Bridge nodes: nodes connecting different communities
    community_map = louvain(nodes_map, edges)
    bridges = nodes_map.values.select { |n|
      neighbors = (n[:out_links] + n[:in_links]).uniq
      neighbor_communities = neighbors.map { |nid| community_map[nid] }.compact.uniq
      neighbor_communities.size > 1
    }.map { |n|
      neighbors = (n[:out_links] + n[:in_links]).uniq
      connected_communities = neighbors.map { |nid| community_map[nid] }.compact.uniq
      { "id" => n[:id], "title" => n[:title], "connected_communities" => connected_communities.size }
    }.sort_by { |b| -b["connected_communities"] }.first(10)

    # Orphan nodes
    orphans = nodes_map.values
      .select { |n| n[:in_links].empty? && n[:out_links].empty? }
      .map { |n| { "id" => n[:id], "title" => n[:title], "type" => n[:type] } }

    {
      "surprise_connections" => surprises,
      "knowledge_gaps" => gaps,
      "bridge_nodes" => bridges,
      "orphan_nodes" => orphans,
      "density" => edges.size > 0 ? (2.0 * edges.size / (nodes_map.size * (nodes_map.size - 1).to_f)).round(4) : 0
    }
  end

  private

  # ── Node Building ────────────────────────────────────────────────────────

  def graph_markdown_files(project_path)
    wiki_dir = File.join(project_path, "wiki")
    return [] unless Dir.exist?(wiki_dir)
    Dir.glob(File.join(wiki_dir, "**", "*.md")).sort
  end

  def graph_signature(project_path, md_files)
    wiki_dir = File.join(project_path, "wiki")
    digest = Digest::SHA256.new
    md_files.each do |file|
      stat = File.stat(file)
      digest << file.sub("#{wiki_dir}/", "") << "\0" << stat.size.to_s << "\0" << stat.mtime.to_f.to_s << "\n"
    rescue SystemCallError
      next
    end
    digest.hexdigest
  end

  def graph_cache_path(project_path)
    File.join(project_path, ".llm-wiki", "graph-cache.json")
  end

  def load_graph_cache(project_path, signature)
    path = graph_cache_path(project_path)
    return nil unless File.file?(path)
    cached = JSON.parse(File.read(path, encoding: "utf-8"))
    return nil unless cached["cache_version"] == CACHE_VERSION && cached["signature"] == signature
    cached["data"].is_a?(Hash) ? cached["data"] : nil
  rescue JSON::ParserError, SystemCallError
    nil
  end

  def save_graph_cache(project_path, signature, data)
    payload = { "cache_version" => CACHE_VERSION, "signature" => signature, "data" => data }
    Storage.atomic_write(graph_cache_path(project_path), JSON.generate(payload), encoding: "utf-8")
  rescue SystemCallError
    nil
  end

  def invalidate_cache(project_path)
    path = graph_cache_path(project_path)
    File.delete(path) if File.file?(path)
  rescue SystemCallError
    nil
  end

  def build_nodes(project_path, md_files: nil)
    wiki_dir = File.join(project_path, "wiki")
    return {} unless Dir.exist?(wiki_dir)

    md_files ||= graph_markdown_files(project_path)
    nodes = {}
    type_aliases = configured_type_aliases(project_path)

    # First pass: build all nodes
    md_files.each do |file|
      relative = file.sub("#{wiki_dir}/", "")
      next if %w[index.md overview.md log.md].include?(relative.downcase)
      id = WikiEngine.page_id(relative)

      content = File.read(file, encoding: "utf-8") rescue next
      fm = WikiEngine.parse_frontmatter(content)
      title = fm["title"] || WikiEngine.extract_title(content, file)
      directory_type = relative.include?("/") ? relative.split("/").first : nil
      raw_type = fm["type"]
      if raw_type.to_s.strip.empty?
        directory_key = normalize_type(directory_type)
        raw_type = type_aliases.key?(directory_key) ? directory_key : singularize_type(directory_type)
      end
      normalized_type = normalize_type(raw_type || "other")
      type = type_aliases.fetch(normalized_type, normalized_type)
      sources = Array(fm["sources"]).compact
      raw_links = WikiEngine.extract_wikilinks(content)

      nodes[id] = {
        id: id,
        title: title,
        type: type,
        path: file.sub("#{project_path}/", ""),
        sources: sources,
        raw_links: raw_links,
        relation_labels: extract_relation_labels(content, fm),
        declared_importance: normalize_importance(fm["importance"] || fm["priority"]),
        out_links: [],
        in_links: []
      }
    end

    # Second pass: resolve links
    node_ids = nodes.keys.to_set
    page_lookup = WikiEngine.page_id_lookup(node_ids)
    nodes.each do |id, node|
      node[:raw_links].each do |target|
        resolved = WikiEngine.resolve_page_id(target, node_ids, from_id: id, lookup: page_lookup)
        next unless resolved && resolved != id
        node[:out_links] << resolved
        nodes[resolved][:in_links] << id if nodes[resolved]
      end
      node[:out_links].uniq!
      node[:relation_labels] = node[:relation_labels].each_with_object({}) do |(target, label), resolved_labels|
        resolved = WikiEngine.resolve_page_id(target, node_ids, from_id: id, lookup: page_lookup)
        resolved_labels[resolved] = label if resolved
      end
    end
    nodes.each { |_, n| n[:in_links].uniq! }

    nodes
  end

  # PageRank supplies global centrality, while degree, inbound references,
  # cross-community bridging and an optional frontmatter priority supply local
  # emphasis. The normalized score is stable across differently-sized wikis.
  def calculate_importance(nodes_map, communities)
    ids = nodes_map.keys
    return {} if ids.empty?

    count = ids.size.to_f
    damping = 0.85
    ranks = ids.to_h { |id| [id, 1.0 / count] }
    30.times do
      dangling = ids.sum { |id| nodes_map[id][:out_links].empty? ? ranks[id] : 0.0 }
      next_ranks = ids.to_h { |id| [id, (1.0 - damping) / count + damping * dangling / count] }
      ids.each do |id|
        links = nodes_map[id][:out_links]
        next if links.empty?
        share = damping * ranks[id] / links.size
        links.each { |target| next_ranks[target] += share if next_ranks.key?(target) }
      end
      ranks = next_ranks
    end

    max_rank = ranks.values.max.to_f.nonzero? || 1.0
    max_degree = nodes_map.values.map { |node| (node[:out_links] + node[:in_links]).uniq.size }.max.to_i
    max_in = nodes_map.values.map { |node| node[:in_links].size }.max.to_i
    raw = {}
    ids.each do |id|
      node = nodes_map[id]
      neighbors = (node[:out_links] + node[:in_links]).uniq
      neighbor_communities = neighbors.map { |neighbor| communities[neighbor] }.compact.uniq
      bridge = neighbors.empty? ? 0.0 : [neighbor_communities.size - 1, 0].max.to_f / [neighbors.size, 1].max
      degree = max_degree.zero? ? 0.0 : Math.log(1 + neighbors.size) / Math.log(1 + max_degree)
      inbound = max_in.zero? ? 0.0 : Math.log(1 + node[:in_links].size) / Math.log(1 + max_in)
      pagerank = ranks[id] / max_rank
      score = pagerank * 0.4 + degree * 0.25 + inbound * 0.15 + bridge * 0.1 + node[:declared_importance] * 0.1
      raw[id] = { score: score, pagerank: pagerank, bridge: bridge }
    end

    max_score = raw.values.map { |value| value[:score] }.max.to_f.nonzero? || 1.0
    raw.transform_values do |value|
      value.merge(
        score: (value[:score] / max_score).round(4),
        pagerank: value[:pagerank].round(4),
        bridge: value[:bridge].round(4)
      )
    end
  end

  def normalize_importance(value)
    return [[value.to_f, 0.0].max, 1.0].min if value.is_a?(Numeric) && value.to_f <= 1
    return [[value.to_f / 10.0, 0.0].max, 1.0].min if value.is_a?(Numeric)
    normalized = value.to_s.strip.downcase
    return 1.0 if %w[critical core highest high important 重点 核心 高].include?(normalized)
    return 0.65 if %w[medium normal 中].include?(normalized)
    return 0.25 if %w[low minor 低].include?(normalized)
    0.0
  end

  # ── Edge Building ────────────────────────────────────────────────────────

  def build_edges(nodes_map)
    edges = []
    seen = Set.new

    nodes_map.each do |id, node|
      node[:out_links].each do |target_id|
        edge_key = [id, target_id].sort.join("--")
        next if seen.include?(edge_key)
        seen << edge_key

        target = nodes_map[target_id]
        next unless target
        weight = calculate_relevance(node, target, nodes_map)
        reciprocal = target[:out_links].include?(id)
        forward_label = node[:relation_labels][target_id]
        backward_label = target[:relation_labels][id]
        label = if reciprocal
          [forward_label, backward_label].compact.uniq.join(" ↔ ")
        else
          forward_label
        end
        label = reciprocal ? "双向关联" : "引用" if label.to_s.strip.empty?
        edges << {
          source: id,
          target: target_id,
          weight: weight.round(3),
          bidirectional: reciprocal,
          label: label
        } if weight > 0
      end
    end

    edges
  end

  def extract_relation_labels(content, frontmatter)
    labels = {}
    relations = frontmatter["relations"]
    if relations.is_a?(Hash)
      relations.each { |target, label| labels[WikiEngine.page_id(target)] = label.to_s.strip }
    end
    content.each_line do |line|
      line.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/).flatten.each do |target|
        id = WikiEngine.page_id(target)
        next if labels[id] && !labels[id].empty?
        prefix = line.sub(/\[\[[^\]]+\]\].*$/, "").sub(/^\s*[-*+]\s*/, "").sub(/^#+\s*/, "").strip
        next unless prefix.match?(/[：:]\s*$/)
        prefix = prefix.sub(/[：:]\s*$/, "").strip
        labels[id] = prefix[0, 32] unless prefix.empty?
      end
    end
    labels
  end

  def config_path(project_path)
    File.join(project_path, ".llm-wiki", "graph-config.json")
  end

  def configured_type_aliases(project_path)
    WikiEngine.configured_type_aliases(project_path)
  end

  def normalize_type(value)
    value.to_s.strip.downcase.gsub(/\s+/, "-").then { |type| type.empty? ? "other" : type }
  end

  def singularize_type(value)
    return nil if value.to_s.empty?
    value.to_s.sub(/ies$/i, "y").sub(/s$/i, "")
  end

  def humanize_type(value)
    DEFAULT_TYPES.dig(value, "label") || value.to_s.tr("-_", " ").split.map(&:capitalize).join(" ")
  end

  def color_for(value)
    TYPE_COLORS[value.to_s.bytes.sum % TYPE_COLORS.length]
  end

  def valid_color(value)
    color = value.to_s.strip
    color.match?(/\A#[0-9a-fA-F]{6}\z/) ? color.downcase : nil
  end

  # ── Four-Signal Relevance ────────────────────────────────────────────────

  def calculate_relevance(node_a, node_b, nodes_map)
    return 0 if node_a[:id] == node_b[:id]

    # Signal 1: Direct links
    forward = node_a[:out_links].include?(node_b[:id]) ? 1 : 0
    backward = node_b[:out_links].include?(node_a[:id]) ? 1 : 0
    direct_score = (forward + backward) * WEIGHTS[:direct_link]

    # Signal 2: Source overlap
    sources_a = node_a[:sources].to_set
    shared_sources = node_b[:sources].count { |s| sources_a.include?(s) }
    source_score = shared_sources * WEIGHTS[:source_overlap]

    # Signal 3: Common neighbors — Adamic-Adar index
    neighbors_a = (node_a[:out_links] + node_a[:in_links]).uniq.to_set
    neighbors_b = (node_b[:out_links] + node_b[:in_links]).uniq.to_set
    adamic_adar = 0.0
    neighbors_a.each do |nid|
      next unless neighbors_b.include?(nid)
      neighbor = nodes_map[nid]
      next unless neighbor
      degree = neighbor[:out_links].size + neighbor[:in_links].size
      adamic_adar += 1.0 / Math.log([degree, 2].max)
    end
    neighbor_score = adamic_adar * WEIGHTS[:common_neighbor]

    # Signal 4: Type affinity
    affinity_map = TYPE_AFFINITY[node_a[:type]]
    type_score = (affinity_map&.dig(node_b[:type]) || 0.5) * WEIGHTS[:type_affinity]

    direct_score + source_score + neighbor_score + type_score
  end

  # ── Louvain Community Detection ─────────────────────────────────────────
  # Pure Ruby implementation of the Louvain method for modularity optimization

  def louvain(nodes_map, edges)
    return {} if nodes_map.empty?

    node_ids = nodes_map.keys
    # Initialize: each node is its own community
    community = {}
    node_ids.each_with_index { |id, i| community[id] = i }

    # Build adjacency with weights
    adj = Hash.new { |h, k| h[k] = {} }
    edges.each do |e|
      adj[e[:source]][e[:target]] = e[:weight]
      adj[e[:target]][e[:source]] = e[:weight]
    end

    # Total weight of all edges
    m = edges.sum { |e| e[:weight] }
    return community if m == 0

    # Node strength (sum of edge weights)
    strength = Hash.new(0.0)
    adj.each { |node, neighbors| neighbors.each { |_, w| strength[node] += w } }

    # Iterative optimization
    improved = true
    max_iterations = 20
    iteration = 0

    while improved && iteration < max_iterations
      improved = false
      iteration += 1

      # Computing these totals inside every node visit made a sparse 5,000-page
      # vault accidentally quadratic. Keep one running total per sweep and
      # update it only when a node changes community.
      comm_totals = Hash.new(0.0)
      node_ids.each { |nid| comm_totals[community[nid]] += strength[nid] }

      node_ids.sort.each do |node|
        next if adj[node].empty?
        current_comm = community[node]

        # Find neighboring communities and modularity gain
        neighbor_comms = Hash.new(0.0)
        adj[node].each do |neighbor, weight|
          neighbor_comms[community[neighbor]] += weight
        end

        # Remove node from current community
        ki = strength[node]
        # Sum of weights to current community
        ki_in_current = neighbor_comms[current_comm] || 0.0

        best_comm = current_comm
        best_gain = 0.0

        neighbor_comms.each do |target_comm, ki_in|
          next if target_comm == current_comm
          sigma_tot = comm_totals[target_comm]

          # Modularity gain formula
          gain = (ki_in - ki_in_current) / m - ki * (sigma_tot - comm_totals[current_comm] + ki) / (2.0 * m * m)

          if gain > best_gain
            best_gain = gain
            best_comm = target_comm
          end
        end

        if best_comm != current_comm
          community[node] = best_comm
          comm_totals[current_comm] -= ki
          comm_totals[best_comm] += ki
          improved = true
        end
      end
    end

    # Renumber communities starting from 0
    unique_comms = community.values.uniq.sort
    comm_remap = {}
    unique_comms.each_with_index { |c, i| comm_remap[c] = i }
    community.transform_values { |c| comm_remap[c] }
  end

  # ── Insights Helpers ─────────────────────────────────────────────────────

  def infer_connection_reason(node_a, node_b, nodes_map)
    reasons = []

    # Check source overlap
    shared = node_a[:sources] & node_b[:sources]
    reasons << "shared sources: #{shared.join(', ')}" if shared.any?

    # Check common neighbors
    neighbors_a = (node_a[:out_links] + node_a[:in_links]).uniq
    neighbors_b = (node_b[:out_links] + node_b[:in_links]).uniq
    common = neighbors_a & neighbors_b
    if common.any?
      common_titles = common.first(3).map { |id| nodes_map[id]&.dig(:title) || id }
      reasons << "common neighbors: #{common_titles.join(', ')}"
    end

    reasons.empty? ? "type affinity and structural similarity" : reasons.join("; ")
  end
end
