# Postgres functions → D1 (TypeScript)

Every function of the Supabase schema (the latest definition of each, one file per function: 208) and where it lives
on D1. Paths are relative to `src/lib/d1/` (`../` = `src/lib/`). "inlined" = the logic is part of another port (a
trigger or a helper that has no caller of its own); "dropped" = the function no longer exists in Postgres. Tests are
the parity tests in `tests/` (`d1-*-parity.test.ts`, PGlite with every migration vs node:sqlite with the D1 schema),
plus `d1-tenant.test.ts` for the data layer; "through X" = covered by the steps that call X.

**199 ported as an export, 8 inlined, 1 dropped, 0 missing.**

Storage (not functions): the buckets and `storage.objects` policies of 0082 (`eliteflow-avatars`: anyone signed in
reads, each person writes only `<own user id>.webp`, webp ≤ 1 MB; `eliteflow-b2b`: `<thread>/<file>`, read by
`b2b_thread_member(thread)`, added by `b2b_thread_member(thread, true)`, ≤ 10 MB, listed mime types) are storage → R2,
enforced in the Worker (which calls `network-chat.ts:b2bThreadMember` for the chat files).

Shared pieces after the consolidation: `common.ts` (fail, now, Postgres text helpers, serviceTenant / systemTenant,
member_role, dept_th, the project stages), `validate.ts` (validate_payload), `entity-insert.ts` (the entities INSERT
triggers, post_stock_movement, code_prefix), `billing-plan.ts` (every plan / quota helper).

| postgres function | TS file:export | parity test |
|---|---|---|
| accept_invitations | company.ts:acceptInvitations | d1-company-parity |
| add_attachment | ingestion.ts:addAttachment | d1-ingestion-parity |
| add_platform_customer | billing-admin.ts:addPlatformCustomer | d1-billing-parity |
| admin_grant_plan | billing-admin.ts:adminGrantPlan | d1-billing-parity |
| admin_revoke_grant | billing-admin.ts:adminRevokeGrant | d1-billing-parity |
| analytics_series | reports.ts:analyticsSeries | d1-reports-parity |
| approval_act | approvals.ts:approvalAct | d1-approvals-parity |
| approval_amount | approvals.ts:approvalAmount | d1-approvals-parity (through approvalPlan); d1-line-parity (lineApprove cards) |
| approval_apply | approvals.ts:approvalApply | d1-approvals-parity |
| approval_plan | approvals.ts:approvalPlan | d1-approvals-parity (every approval step); d1-line-parity |
| approval_requester | approvals.ts:approvalRequester | d1-approvals-parity (approvalAct: "cannot approve your own request") |
| approval_statuses | inlined: ../dept-rules.ts approvalStatuses (read by entity-insert.ts beforeEntityInsert and network-common.ts setEntityStmts) | d1-entities-parity, d1-approvals-parity |
| approve_deal | approvals.ts:approveDeal | d1-approvals-parity |
| archive_entity | entities.ts:archiveEntity | d1-entities-parity |
| assign_entity_code | entity-insert.ts:beforeEntityInsert (trigger entities_code; update path in entities.ts saveEntity, network-common.ts setEntityStmts) | d1-entities-parity, d1-approvals-parity, d1-company-parity (sample data), d1-network-deals-parity |
| b2b_accepted_quote | network-deals.ts:b2bAcceptedQuote | d1-network-deals-parity |
| b2b_bkk_today | network-deals.ts:b2bBkkToday | d1-network-deals-parity |
| b2b_card_json | network-deals.ts:b2bCardJson | d1-network-deals-parity (through the deal cards) |
| b2b_card_note | network-chat.ts:cardNoteStmts | d1-network-deals-parity (every card note) |
| b2b_deal_cancel | network-deals.ts:b2bDealCancel | d1-network-deals-parity |
| b2b_deal_cancel_answer | network-deals.ts:b2bDealCancelAnswer (0083: the buyer's project is cancelled with a description, an older task is done with notes) | d1-network-deals-parity |
| b2b_deal_check | network-deals.ts:b2bDealCheck (0083: the buyer's project completed 100%, an older task done) | d1-network-deals-parity |
| b2b_deal_decide | network-deals.ts:b2bDealDecide (0083/0084: the buyer gets a project, not a task; both projects name ผู้รับผิดชอบ; the deal's contacts are set) | d1-network-deals-parity |
| b2b_deal_deliver | network-deals.ts:b2bDealDeliver | d1-network-deals-parity |
| b2b_deal_for | network-deals.ts:b2bDealFor | d1-network-deals-parity (through b2bDealRequest) |
| b2b_deal_fully_paid | network-deals.ts:b2bDealFullyPaid | d1-network-deals-parity |
| b2b_deal_invoice | network-deals.ts:b2bDealInvoice | d1-network-deals-parity |
| b2b_deal_pay | network-deals.ts:b2bDealPay | d1-network-deals-parity |
| b2b_deal_progress | network-deals.ts:b2bDealProgress | d1-network-deals-parity |
| b2b_deal_quote | network-deals.ts:b2bDealQuote | d1-network-deals-parity |
| b2b_deal_receive | network-deals.ts:b2bDealReceive | d1-network-deals-parity |
| b2b_deal_request | network-deals.ts:b2bDealRequest | d1-network-deals-parity |
| b2b_deal_take | network-deals.ts:b2bDealTake (0084) | d1-network-deals-parity |
| b2b_deal_withdraw | network-deals.ts:b2bDealWithdraw | d1-network-deals-parity |
| b2b_deals_of | network-deals.ts:b2bDealsOf (contact_mine / contact_theirs / contact_is_me since 0084) | d1-network-deals-parity |
| b2b_inbox | network-chat.ts:b2bInbox (files-only text: network-chat.ts b2bShownBody) | d1-network-chat-parity, d1-network-deals-parity |
| b2b_installment_amount | network-deals.ts:b2bInstallmentAmount | d1-network-deals-parity |
| b2b_installments | network-deals.ts:b2bInstallments | d1-network-deals-parity |
| b2b_items | network-deals.ts:b2bItems | d1-network-deals-parity |
| b2b_open | network-chat.ts:b2bOpen | d1-network-chat-parity, d1-network-deals-parity |
| b2b_party | network-deals.ts:b2bParty | d1-network-deals-parity |
| b2b_post | network-chat.ts:b2bPost | d1-network-chat-parity |
| b2b_post_card | network-chat.ts:b2bPostCard | d1-network-chat-parity |
| b2b_read | network-chat.ts:b2bRead (files + sender fields since 0082) | d1-network-chat-parity, d1-network-deals-parity |
| b2b_send | network-chat.ts:b2bSend (p_files since 0082) | d1-network-chat-parity |
| b2b_sender | inlined: network-chat.ts senders (b2b_sender for a batch of messages, used by b2bSend / b2bRead) | d1-network-chat-parity, d1-network-deals-parity |
| b2b_set_entity | network-common.ts:setEntityStmts | d1-network-deals-parity (progress, delivery, payment, cancel) |
| b2b_thread_member | network-chat.ts:b2bThreadMember | d1-network-chat-parity |
| b2b_thread_of | network-chat.ts:b2bThreadOf | d1-network-chat-parity |
| b2b_unread | network-chat.ts:b2bUnread | d1-network-chat-parity |
| b2b_writer | network-chat.ts:b2bWriter | d1-network-chat-parity |
| buy_feed_ad | billing-ads.ts:buyFeedAd | d1-billing-parity |
| buy_module | billing-shop.ts:buyModule | d1-billing-parity |
| calendar_entries | reports.ts:calendarEntries | d1-reports-parity |
| can_read_dept | access.ts:canReadDept (departments or read_departments since 0085; also the read rules in access.ts readRules) | d1-tenant; d1-company-parity; d1-postgrest; every parity test |
| can_write_dept | access.ts:canWriteDept (owner or a departments entry, never a viewer; read_departments never count, 0085) | d1-tenant; d1-company-parity; every parity test |
| claim_ingestion | ingestion.ts:claimIngestion | d1-ingestion-parity |
| claim_notifications | company-share.ts:claimNotifications | d1-company-parity |
| clear_sample_data | company-sample.ts:clearSampleData | d1-company-parity |
| code_prefix | entity-insert.ts:codePrefix | d1-entities-parity, d1-ingestion-parity (takeCode / peekCode) |
| comment_design_revision | ingestion.ts:commentDesignRevision | d1-ingestion-parity |
| companies_seed_accounts | finance.ts:companiesSeedAccounts (passed to company.ts createCompany as seedAccounts) | d1-finance-parity, d1-company-parity |
| company_card | company.ts:companyCard | d1-company-parity |
| company_cover | company.ts:companyCover | d1-company-parity |
| complete_ingestion | ingestion.ts:completeIngestion | d1-ingestion-parity |
| complete_sorted_ingestion | ingestion.ts:completeSortedIngestion | d1-ingestion-parity |
| confirm_payment | billing-shop.ts:confirmPayment | d1-billing-parity |
| confirm_topup | billing-shop.ts:confirmTopup | d1-billing-parity |
| create_approver_code | dropped: migration 0072_line_approvers_no_code drops the function | - |
| create_company | company.ts:createCompany | d1-company-parity |
| create_design_revision | ingestion.ts:createDesignRevision | d1-ingestion-parity |
| create_ingestion_workflow | approvals.ts:createIngestionWorkflow | d1-approvals-parity, d1-line-parity (lineExpensePaid) |
| create_share | company-share.ts:createShare | d1-company-parity |
| dashboard_summary | reports.ts:dashboardSummary | d1-reports-parity |
| decide_ingestion | ingestion.ts:decideIngestion | d1-ingestion-parity |
| department_names | company.ts:departmentNames | d1-company-parity |
| dept_derive | inlined: ../dept-rules.ts derive (called by entity-insert.ts beforeEntityInsert, entities.ts, operations.ts, network-common.ts) | d1-entities-parity, d1-operations-parity |
| dept_list | company.ts:deptList | d1-company-parity |
| dept_th | common.ts:deptTh (re-exported by reports.ts and approvals.ts) | d1-reports-parity |
| document_number | finance.ts:documentNumber | d1-finance-parity |
| edit_member | company.ts:editMember (p_read_departments since 0085; null keeps the member's) | d1-company-parity |
| effective_plan | billing-plan.ts:effectivePlan (effectiveOf for a row already read) | d1-billing-parity, d1-reports-parity |
| end_support_access | company.ts:endSupportAccess | d1-company-parity |
| enforce_quota | billing-plan.ts:enforceQuota (called before inserts in approvals.ts saveTemplate, ingestion.ts submitIngestion, line.ts pairLineGroup, company.ts createCompany / acceptInvitations) | d1-billing-parity, d1-approvals-parity, d1-company-parity |
| entity_dept_rules | entity-insert.ts:beforeEntityInsert (insert); entities.ts:saveEntity and network-common.ts:setEntityStmts (update) | d1-entities-parity, d1-approvals-parity, d1-network-deals-parity |
| entity_stock_effect | entity-insert.ts:stockEffect (via afterEntityInsert on insert; entities.ts saveEntity on update) | d1-entities-parity, d1-company-parity (sample data) |
| entity_takes_item_files | entity-insert.ts:takeItemFiles (via afterEntityInsert) | d1-approvals-parity, d1-ingestion-parity |
| expire_subscriptions | billing-plan.ts:expireSubscriptions | d1-billing-parity |
| feed_ad_track | billing-ads.ts:feedAdTrack | d1-billing-parity |
| feed_ads_live | billing-ads.ts:feedAdsLive | d1-billing-parity |
| feed_alerts | network-feed.ts:feedAlerts (files-only text: network-chat.ts b2bShownBody) | d1-network-chat-parity, d1-network-feed-parity |
| feed_author | network-common.ts:feedAuthor | d1-network-feed-parity |
| feed_comment | network-feed.ts:feedComment | d1-network-feed-parity |
| feed_companies | network-feed.ts:feedCompanies | d1-network-feed-parity |
| feed_company_profile | network-feed.ts:feedCompanyProfile | d1-network-feed-parity |
| feed_delete | network-feed.ts:feedDelete | d1-network-chat-parity, d1-network-feed-parity |
| feed_follow | network-feed.ts:feedFollow | d1-network-feed-parity |
| feed_follow_list | network-feed.ts:feedFollowList | d1-network-feed-parity |
| feed_like | network-feed.ts:feedLike | d1-network-feed-parity |
| feed_list | network-feed.ts:feedList | d1-network-feed-parity |
| feed_post | network-feed.ts:feedPost | d1-network-chat-parity, d1-network-feed-parity |
| feed_proposal_status | network-feed.ts:feedProposalStatus | d1-network-feed-parity |
| feed_proposals | network-feed.ts:feedProposals | d1-network-feed-parity |
| feed_propose | network-feed.ts:feedPropose | d1-network-feed-parity |
| feed_save | network-feed.ts:feedSave | d1-network-feed-parity |
| feed_share | network-feed.ts:feedShare | d1-network-feed-parity |
| feed_signed_in | network-feed.ts:feedSignedIn | d1-network-feed-parity |
| feed_suggest | network-feed.ts:feedSuggest | d1-network-feed-parity |
| feed_view | network-feed.ts:feedView | d1-network-feed-parity |
| finance_close_step | finance.ts:financeCloseStep | d1-finance-parity |
| finance_manager | finance.ts:financeManager | d1-finance-parity |
| finance_save_budgets | finance.ts:financeSaveBudgets | d1-finance-parity |
| finance_save_targets | finance.ts:financeSaveTargets | d1-finance-parity |
| goal_set | finance.ts:goalSet | d1-finance-parity |
| has_addon | billing-plan.ts:hasAddon | d1-billing-parity |
| hhmm | reports.ts:hhmm | d1-reports-parity |
| ingestion_decision_notify | inlined: ingestion.ts decisionNotify (inside updateStatus) | d1-ingestion-parity, d1-line-parity |
| ingestion_decision_stamp | approvals.ts:decisionStamp (also used by ingestion.ts updateStatus) | d1-approvals-parity, d1-ingestion-parity, d1-line-parity |
| ingestion_to_entity | approvals.ts:ingestionToEntity | d1-approvals-parity, d1-ingestion-parity, d1-line-parity |
| init_project_stages | company-share.ts:initProjectStages (stage list: common.ts projectStages) | d1-company-parity |
| invite_member | company.ts:inviteMember | d1-company-parity |
| issue_document | finance.ts:issueDocument | d1-finance-parity |
| issued_documents_list | finance.ts:issuedDocumentsList | d1-finance-parity |
| item_file_count | ingestion.ts:itemFileCount | d1-ingestion-parity |
| keep_source_keys | inlined: entities.ts saveEntity (update path, SOURCE_KEYS) | d1-entities-parity |
| line_add_evidence | line.ts:lineAddEvidence | d1-line-parity |
| line_approval_act | line.ts:lineApprovalAct | d1-line-parity |
| line_approve | line.ts:lineApprove | d1-line-parity |
| line_decide | line.ts:lineDecide | d1-line-parity |
| line_documents | line.ts:lineDocuments | d1-line-parity |
| line_draft_decide | line.ts:lineDraftDecide | d1-line-parity |
| line_evidence_check | line.ts:lineEvidenceCheck | d1-line-parity |
| line_expense_paid | line.ts:lineExpensePaid | d1-line-parity |
| line_expense_summary | line.ts:lineExpenseSummary | d1-line-parity |
| line_group_approver_for | line.ts:lineGroupApproverFor | d1-line-parity (through lineApprove / lineApprovalAct) |
| line_keyword_approve | line.ts:lineKeywordApprove | d1-line-parity |
| line_quick_stats | line.ts:lineQuickStats | d1-line-parity |
| line_set_approvers | line.ts:lineSetApprovers | d1-line-parity |
| line_slip_check | line.ts:lineSlipCheck | d1-line-parity |
| link_attachment | ingestion.ts:linkAttachment | d1-ingestion-parity |
| load_sample_data | company-sample.ts:loadSampleData | d1-company-parity |
| log_action | inlined: an audit_events insert in each batch (ingestion.ts logAction for the ingestion functions) | every parity test (audit_events compared) |
| member_role | common.ts:memberRoleIn (company.ts:memberRole for building a Viewer; inside ported functions viewer.role) | d1-company-parity, d1-network-feed-parity, d1-network-deals-parity |
| my_avatar | network-chat.ts:myAvatar | d1-network-chat-parity |
| my_feed_ads | billing-ads.ts:myFeedAds | d1-billing-parity |
| next_number | tenant.ts:Tenant.nextNumber (Tenant.nextNumberIntoStmts for another company inside a batch) | d1-tenant, d1-entities-parity, d1-network-deals-parity |
| note_delete | company-share.ts:noteDelete | d1-company-parity |
| note_save | company-share.ts:noteSave | d1-company-parity |
| on_trial | billing-plan.ts:onTrial (= trialValid) | d1-billing-parity |
| pair_line_group | line.ts:pairLineGroup | d1-line-parity |
| pair_line_user | line.ts:pairLineUser | d1-line-parity |
| peek_code | ingestion.ts:peekCode | d1-ingestion-parity |
| plan_limit | billing-plan.ts:planLimit | d1-billing-parity |
| platform_company | billing-admin.ts:platformCompany | d1-billing-parity |
| platform_customer_on_signup | billing-admin.ts:platformCustomerOnSignup | d1-billing-parity |
| post_expense | finance.ts:postExpense | d1-finance-parity |
| post_stock_movement | entity-insert.ts:stockMove (re-exported by entities.ts) | d1-entities-parity, d1-operations-parity, d1-company-parity (sample data) |
| presence_ping | company.ts:presencePing | d1-company-parity |
| project_stage_init_trigger | entity-insert.ts:projectStageStmts (via afterEntityInsert; network-common.ts insertEntityStmts for another company) | d1-entities-parity, d1-company-parity, d1-network-deals-parity |
| purchase_action | operations.ts:purchaseAction | d1-operations-parity |
| purchase_figures | entity-insert.ts:purchaseFigures (insert via beforeEntityInsert; entities.ts saveEntity on update) | d1-entities-parity, d1-operations-parity |
| purge_voice_files | ingestion.ts:purgeVoiceFiles | d1-ingestion-parity |
| queue_nudges | approvals.ts:queueNudges | d1-approvals-parity |
| recalculate_invoice | inlined: entities.ts recalcInvoice (not callable by clients: revoked in 0001_core) | d1-entities-parity (payments / archive) |
| remove_line_approver | line.ts:removeLineApprover | d1-line-parity |
| request_payment | billing-shop.ts:requestPayment | d1-billing-parity |
| request_topup | billing-shop.ts:requestTopup | d1-billing-parity |
| retry_ingestion | ingestion.ts:retryIngestion | d1-ingestion-parity |
| review_design_revision | ingestion.ts:reviewDesignRevision | d1-ingestion-parity |
| revoke_share | company-share.ts:revokeShare | d1-company-parity |
| save_company | company.ts:saveCompany | d1-company-parity |
| save_dashboard_layout | company-share.ts:saveDashboardLayout | d1-company-parity |
| save_entity | entities.ts:saveEntity | d1-entities-parity, d1-finance-parity, d1-operations-parity, d1-approvals-parity |
| save_entity_as | approvals.ts:saveEntityAs | d1-approvals-parity |
| save_template | approvals.ts:saveTemplate | d1-approvals-parity |
| seed_accounts | finance.ts:seedAccountsStmts | d1-finance-parity, d1-company-parity (createCompany) |
| send_message | company.ts:sendMessage | d1-company-parity |
| set_feed_ad_status | billing-ads.ts:setFeedAdStatus | d1-billing-parity |
| set_line_group_listen | line.ts:setLineGroupListen | d1-line-parity |
| set_member_access | company.ts:setMemberAccess | d1-company-parity |
| set_my_avatar | network-chat.ts:setMyAvatar | d1-network-chat-parity |
| set_template_target | approvals.ts:setTemplateTarget | d1-approvals-parity |
| share_failed | company-share.ts:shareFailed | d1-company-parity |
| share_lockout | company-share.ts:shareLockout | d1-company-parity |
| share_metrics | company-share.ts:shareMetrics | d1-company-parity |
| shop_activate | billing-shop.ts:shopActivate | d1-billing-parity |
| shop_buy | billing-shop.ts:shopBuy | d1-billing-parity |
| start_trial | billing-plan.ts:startTrial | d1-billing-parity |
| submit_ingestion | ingestion.ts:submitIngestion | d1-ingestion-parity |
| subscription_active | billing-plan.ts:subscriptionActive | d1-billing-parity |
| support_reply | company.ts:supportReply | d1-company-parity |
| support_seen | company.ts:supportSeen | d1-company-parity |
| support_send | company.ts:supportSend | d1-company-parity |
| support_viewer | common.ts:supportViewerIn | d1-company-parity |
| take_code | ingestion.ts:takeCode (the entities_code hook in entity-insert.ts takes the same number) | d1-ingestion-parity |
| template_breakdowns | reports.ts:templateBreakdowns | d1-reports-parity |
| template_metrics | reports.ts:templateMetrics | d1-reports-parity |
| thai_year | inlined: ../domain.ts thaiYear (network-common.ts thaiYear for a given timestamp) | d1-entities-parity (codes) |
| transfer_project_stock | operations.ts:transferProjectStock | d1-operations-parity |
| trial_limit | billing-plan.ts:trialLimit | d1-billing-parity |
| trial_usage | billing-plan.ts:trialUsage | d1-billing-parity |
| trial_valid | billing-plan.ts:trialValid | d1-billing-parity |
| unlink_line_group | line.ts:unlinkLineGroup | d1-line-parity |
| update_line_group | line.ts:updateLineGroup | d1-line-parity |
| update_project_stage | operations.ts:updateProjectStage | d1-operations-parity |
| usage_summary | reports.ts:usageSummary | d1-reports-parity |
| validate_payload | validate.ts:validatePayload (entities.ts validateFor for a save) | d1-entities-parity (incl. raw-payload steps), d1-approvals-parity, d1-company-parity (sample data) |
| web_approval_act | approvals.ts:webApprovalAct | d1-approvals-parity |
