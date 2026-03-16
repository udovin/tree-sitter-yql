; ============================================================================
; Local variable scoping and reference queries for YTsaurus YQL
; ============================================================================

; ---------------------------------------------------------------------------
; Scopes — blocks that introduce new variable visibility
; ---------------------------------------------------------------------------

(source_file) @local.scope

(lambda_body) @local.scope

(define_action_statement) @local.scope

(define_subquery_statement) @local.scope

(inline_action) @local.scope

(begin_end_do_statement) @local.scope

(evaluate_for_statement) @local.scope

; ---------------------------------------------------------------------------
; Definitions — named expressions that bind a value
; ---------------------------------------------------------------------------

; $x = expr
(named_expr_assignment
  (named_expression) @local.definition)

; Lambda parameters: ($x, $y?) -> ...
(lambda_params
  (named_expression) @local.definition)

; Action parameters: DEFINE ACTION $act($p, $q?) AS ...
(action_param
  (named_expression) @local.definition)

; EVALUATE FOR $i IN list
(evaluate_for_statement
  (named_expression) @local.definition)

; DECLARE $x AS Type
(declare_statement
  (named_expression) @local.definition)

; IMPORT lib SYMBOLS $sym AS $alias
(import_symbol
  (named_expression) @local.definition)

; ---------------------------------------------------------------------------
; References — uses of named expressions
; ---------------------------------------------------------------------------

(named_expression) @local.reference
